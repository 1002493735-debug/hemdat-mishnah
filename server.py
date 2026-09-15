"""School-wide Mishnah game. SQLite is the authority; all writes use BEGIN IMMEDIATE."""
import csv
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from contextlib import contextmanager
from flask import Flask, request, jsonify, send_from_directory, make_response

ROOT = Path(__file__).parent
STRUCTURE = json.loads((ROOT / "data/structure.json").read_text())
CANON = {f"{t['id']}:{c}:{m}": (t["id"], c, m)
         for t in STRUCTURE for c, count in enumerate(t["chapters"], 1)
         for m in range(1, count + 1)}
TOTAL = len(CANON)

class GameError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status

def now():
    return int(time.time())

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def require(condition, message, status=400):
    if not condition:
        raise GameError(message, status)

def connect(path):
    db = sqlite3.connect(path, timeout=20, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=20000")
    return db

@contextmanager
def transaction(path):
    db = connect(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def init_db(path, demo=True):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript((ROOT / "migrations/001.sql").read_text())
    db.close()
    with transaction(path) as db:
        fresh = not db.execute("SELECT 1 FROM schema_versions WHERE version=1").fetchone()
        for t in STRUCTURE:
            db.execute("INSERT OR IGNORE INTO tractates VALUES(?,?)", (t["id"], t["name"]))
            for c in range(1, len(t["chapters"]) + 1):
                db.execute("INSERT OR IGNORE INTO chapters VALUES(?,?)", (t["id"], c))
        for mid, coordinates in CANON.items():
            db.execute("INSERT OR IGNORE INTO mishnayot VALUES(?,?,?,?)", (mid, *coordinates))
            db.execute("INSERT OR IGNORE INTO content(mishnah_id) VALUES(?)", (mid,))
        if fresh:
            db.execute("INSERT INTO rounds(number,started_at) VALUES(1,?)", (now(),))
            if demo:
                import_students(db, [
                    {"id":"demo-1","name":"תלמיד לדוגמה א","class_id":"demo-a","class_name":"כיתת הדגמה א"},
                    {"id":"demo-2","name":"תלמידה לדוגמה ב","class_id":"demo-a","class_name":"כיתת הדגמה א"},
                    {"id":"demo-3","name":"תלמיד לדוגמה ג","class_id":"demo-b","class_name":"כיתת הדגמה ב"},
                    {"id":"demo-4","name":"תלמידה לדוגמה ד","class_id":"demo-b","class_name":"כיתת הדגמה ב"}], True)
                rows = json.loads((ROOT / "data/content.json").read_text())
                report = validate_content(rows)
                if report["errors"]:
                    raise RuntimeError(report["errors"])
                apply_content(db, rows)
            db.execute("INSERT INTO schema_versions VALUES(1,?)", (now(),))

def record(db, action, details, actor="admin"):
    db.execute("INSERT INTO audit(at,actor,action,details) VALUES(?,?,?,?)",
               (now(), actor, action, json.dumps(details, ensure_ascii=False)))

def validate_content(rows, full=False):
    errors, seen = [], set()
    if not isinstance(rows, list) or len(rows) > TOTAL:
        return {"errors":["הקובץ חייב להכיל מערך של עד 149 רשומות"],"missing":sorted(CANON)}
    for i, r in enumerate(rows, 1):
        if not isinstance(r, dict):
            errors.append(f"שורה {i}: רשומה לא תקינה")
            continue
        mid = r.get("id")
        if not isinstance(mid, str) or mid not in CANON:
            errors.append(f"שורה {i}: מזהה לא תקין")
            continue
        if mid in seen:
            errors.append(f"{mid}: משנה כפולה")
        seen.add(mid)
        status = r.get("status")
        if status not in ("missing","ready","review"):
            errors.append(f"{mid}: סטטוס לא תקין")
        if not isinstance(r.get("text",""), str) or len(r.get("text","")) > 20000:
            errors.append(f"{mid}: טקסט לא תקין")
        questions = r.get("questions", [])
        if not isinstance(questions, list):
            errors.append(f"{mid}: שאלות לא תקינות")
            continue
        if status == "ready" and (not r.get("text","").strip() or len(questions) != 2):
            errors.append(f"{mid}: טקסט חסר או שאלה חסרה; נדרשות שתי שאלות")
        if len(questions) > 2:
            errors.append(f"{mid}: נדרשות לכל היותר שתי שאלות")
        for q in questions:
            if not isinstance(q, dict) or not isinstance(q.get("prompt"), str) or not q["prompt"].strip():
                errors.append(f"{mid}: שאלה חסרה")
                continue
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 4 or not all(isinstance(o,str) and o.strip() for o in opts):
                errors.append(f"{mid}: נדרשות ארבע תשובות לא ריקות")
            elif len(set(opts)) != 4:
                errors.append(f"{mid}: תשובות כפולות")
            elif not isinstance(q.get("correct"), str) or q["correct"] not in opts:
                errors.append(f"{mid}: התשובה הנכונה אינה בין האפשרויות")
    missing = sorted(set(CANON) - seen)
    if full and missing:
        errors.append(f"חסרות {len(missing)} משניות בייבוא מלא")
    return {"errors":errors,"missing":missing,"count":len(seen)}

def apply_content(db, rows):
    for r in rows:
        db.execute("UPDATE content SET text=?,questions=?,status=?,revision=revision+1 WHERE mishnah_id=?",
                   (r.get("text",""), json.dumps(r.get("questions",[]),ensure_ascii=False),r["status"],r["id"]))
    # Existing leases keep a content snapshot. Import never changes rounds, tickets or completions.

def import_students(db, rows, apply=False):
    errors, seen, class_names = [], set(), {}
    if not isinstance(rows,list) or len(rows) > 10000:
        return {"errors":["נדרש מערך תלמידים של עד 10000 שורות"]}
    for i, r in enumerate(rows,1):
        if not isinstance(r,dict) or not all(isinstance(r.get(k),str) and 0 < len(r[k].strip()) <= 120 for k in ("id","name","class_id","class_name")):
            errors.append(f"שורה {i}: חסרים מזהה, שם, מזהה כיתה או שם כיתה")
            continue
        if r["id"] in seen:
            errors.append(f"שורה {i}: מזהה תלמיד כפול")
        seen.add(r["id"])
        cid, cname = r["class_id"], r["class_name"]
        if cid in class_names and class_names[cid] != cname:
            errors.append(f"שורה {i}: שמות סותרים לאותה כיתה")
        if cname in class_names.values() and class_names.get(cid) != cname:
            errors.append(f"שורה {i}: שם כיתה משויך למזהים שונים")
        class_names[cid] = cname
        conflict = db.execute("SELECT id FROM classes WHERE name=? AND id<>?",(cname,cid)).fetchone()
        if conflict:
            errors.append(f"שורה {i}: שם הכיתה קיים עם מזהה אחר")
    if not errors and apply:
        for cid, cname in class_names.items():
            db.execute("INSERT INTO classes VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",(cid,cname))
        for r in rows:
            db.execute("INSERT INTO students(id,name,class_id) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,class_id=excluded.class_id",
                       (r["id"],r["name"],r["class_id"]))
    return {"errors":errors,"count":len(rows)}

def active_round(db):
    return db.execute("SELECT * FROM rounds WHERE finished_at IS NULL").fetchone()

def new_round(db):
    n = db.execute("SELECT COALESCE(MAX(number),0)+1 FROM rounds").fetchone()[0]
    db.execute("INSERT INTO rounds(number,started_at) VALUES(?,?)",(n,now()))
    return n

def totals(db, rid):
    return db.execute("SELECT count(*) FROM completions WHERE round_id=? AND revoked_at IS NULL",(rid,)).fetchone()[0]

def expire(db):
    db.execute("UPDATE leases SET result='expired' WHERE result IS NULL AND expires_at<=?",(now(),))
    db.execute("DELETE FROM sessions WHERE expires_at<=?",(now(),))
    db.execute("DELETE FROM cooldowns WHERE until_at<=?",(now(),))

def acquire(db, student, mid=None):
    expire(db)
    rnd = active_round(db)
    require(rnd is not None,"הסבב הסתיים. ממתינים לפתיחת סבב נוסף.",409)
    lease = db.execute("SELECT * FROM leases WHERE student_id=? AND result IS NULL",(student,)).fetchone()
    if lease:
        return dict(lease)
    sql = """SELECT m.id,c.* FROM mishnayot m JOIN content c ON c.mishnah_id=m.id
        WHERE c.status='ready'
        AND NOT EXISTS(SELECT 1 FROM completions x WHERE x.round_id=? AND x.mishnah_id=m.id AND x.revoked_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leases l WHERE l.round_id=? AND l.mishnah_id=m.id AND l.result IS NULL)
        AND NOT EXISTS(SELECT 1 FROM cooldowns d WHERE d.student_id=? AND d.mishnah_id=m.id AND d.until_at>?)"""
    args = [rnd["id"],rnd["id"],student,now()]
    if mid:
        sql += " AND m.id=?"
        args.append(mid)
    options = db.execute(sql,args).fetchall()
    require(bool(options),"אין כרגע משנה מוכנה ופנויה עבורך. אפשר לנסות שוב בהמשך.",409)
    c = secrets.choice(options)
    lid = secrets.token_urlsafe(24)
    duration = int(db.execute("SELECT value FROM settings WHERE key='lease_seconds'").fetchone()[0])
    db.execute("""INSERT INTO leases(id,round_id,mishnah_id,student_id,expires_at,content_revision,text,questions)
               VALUES(?,?,?,?,?,?,?,?)""",(lid,rnd["id"],c["id"],student,now()+duration,c["revision"],c["text"],c["questions"]))
    return dict(db.execute("SELECT * FROM leases WHERE id=?",(lid,)).fetchone())

def owned_lease(db, lid, sid):
    lease = db.execute("SELECT * FROM leases WHERE id=? AND student_id=?",(lid,sid)).fetchone()
    require(lease is not None,"הלימוד לא נמצא",404)
    return lease

def challenge(db, lid, sid):
    l = owned_lease(db,lid,sid)
    require(l["result"] is None and l["expires_at"]>now(),"זמן הלימוד הסתיים. בחרו משנה מחדש.",409)
    if l["challenge"]:
        q = json.loads(l["challenge"])
    else:
        original = secrets.choice(json.loads(l["questions"]))
        options = list(original["options"])
        secrets.SystemRandom().shuffle(options)
        q = {"prompt":original["prompt"],"options":[{"id":secrets.token_urlsafe(12),"text":o} for o in options]}
        q["correct_id"] = next(o["id"] for o in q["options"] if o["text"]==original["correct"])
        db.execute("UPDATE leases SET challenge=? WHERE id=?",(json.dumps(q,ensure_ascii=False),lid))
    return {k:v for k,v in q.items() if k!="correct_id"}

def answer(db, lid, sid, option):
    l = owned_lease(db,lid,sid)
    if l["result"] in ("correct","wrong","taken"):
        return {"result":l["result"],"replayed":True}
    exists = db.execute("SELECT 1 FROM completions WHERE round_id=? AND mishnah_id=? AND revoked_at IS NULL",(l["round_id"],l["mishnah_id"])).fetchone()
    if exists:
        db.execute("UPDATE leases SET result='taken' WHERE id=?",(lid,))
        return {"result":"taken"}
    require(l["result"] is None and l["expires_at"]>now(),"הנעילה פגה. בחרו משנה מחדש.",409)
    require(l["challenge"] is not None,"יש לקרוא את המשנה לפני השאלה")
    q = json.loads(l["challenge"])
    require(option in [o["id"] for o in q["options"]],"אפשרות תשובה לא תקינה")
    if option != q["correct_id"]:
        seconds = int(db.execute("SELECT value FROM settings WHERE key='cooldown_seconds'").fetchone()[0])
        db.execute("INSERT INTO cooldowns VALUES(?,?,?) ON CONFLICT(student_id,mishnah_id) DO UPDATE SET until_at=excluded.until_at",(sid,l["mishnah_id"],now()+seconds))
        db.execute("UPDATE leases SET result='wrong' WHERE id=?",(lid,))
        return {"result":"wrong","until":now()+seconds}
    rnd = active_round(db)
    require(rnd is not None and rnd["id"]==l["round_id"],"הסבב השתנה; בחרו משנה מחדש.",409)
    cls = db.execute("SELECT class_id FROM students WHERE id=?",(sid,)).fetchone()[0]
    cur = db.execute("INSERT INTO completions(round_id,mishnah_id,student_id,class_id,completed_at,content_revision) VALUES(?,?,?,?,?,?)",
                     (l["round_id"],l["mishnah_id"],sid,cls,now(),l["content_revision"]))
    db.execute("INSERT INTO tickets(student_id,delta,completion_id,reason,created_at) VALUES(?,1,?,'completion',?)",(sid,cur.lastrowid,now()))
    db.execute("UPDATE leases SET result='correct' WHERE id=?",(lid,))
    tractate = CANON[l["mishnah_id"]][0]
    total = sum(next(t["chapters"] for t in STRUCTURE if t["id"]==tractate))
    done = db.execute("SELECT count(*) FROM completions c JOIN mishnayot m ON c.mishnah_id=m.id WHERE c.round_id=? AND c.revoked_at IS NULL AND m.tractate=?",(rnd["id"],tractate)).fetchone()[0]
    result = {"result":"correct","tractate_completed":tractate if done==total else None,"all_completed":False}
    if totals(db,rnd["id"])==TOTAL:
        db.execute("UPDATE rounds SET finished_at=? WHERE id=?",(now(),rnd["id"]))
        result["all_completed"]=True
        if rnd["number"]==1:
            result["bonus_round"]=new_round(db)
    return result

def csv_output(columns, rows):
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(columns)
    for row in rows:
        vals = []
        for col in columns:
            value = row.get(col,"")
            # Prevent spreadsheet formula execution for all exported string fields.
            if isinstance(value,str) and value.lstrip().startswith(("=","+","-","@","\t","\r")):
                value = "'" + value
            vals.append(value)
        writer.writerow(vals)
    return "\ufeff" + buf.getvalue()

def create_app(config=None):
    app = Flask(__name__,static_folder="static",static_url_path="/static")
    app.config.update(DATABASE_PATH=os.getenv("DATABASE_PATH","./game.db"),
                      ADMIN_PASSWORD=os.getenv("ADMIN_PASSWORD",""),
                      SCHOOL_CODE=os.getenv("SCHOOL_CODE",""),
                      COOKIE_SECURE=os.getenv("COOKIE_SECURE","1")=="1",
                      MAX_CONTENT_LENGTH=4*1024*1024)
    if config:
        app.config.update(config)
    require(len(app.config["ADMIN_PASSWORD"])>=12,"ADMIN_PASSWORD must contain at least 12 characters")
    require(len(app.config["SCHOOL_CODE"])>=4,"SCHOOL_CODE must contain at least 4 characters")
    init_db(app.config["DATABASE_PATH"],os.getenv("SEED_DEMO","1")=="1")

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"]="nosniff"
        response.headers["X-Frame-Options"]="DENY"
        response.headers["Referrer-Policy"]="same-origin"
        response.headers["Content-Security-Policy"]="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if request.path.startswith("/api"):
            response.headers["Cache-Control"]="no-store"
        return response

    @app.errorhandler(GameError)
    def game_error(e):
        return jsonify(error=e.message),e.status

    @app.errorhandler(413)
    def too_large(e):
        return jsonify(error="הקובץ גדול מדי. גודל מרבי: 4MB"),413

    @app.errorhandler(sqlite3.IntegrityError)
    def conflict(e):
        return jsonify(error="הפעולה מתנגשת בנתון קיים. רעננו ונסו שוב."),409

    @app.route("/")
    def index():
        return send_from_directory(app.static_folder,"index.html")

    @app.route("/health")
    def health():
        return jsonify(status="ok")

    def session(db, role=None):
        token = request.cookies.get("session","")
        s = db.execute("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",(digest(token),now())).fetchone()
        require(s is not None,"נדרשת כניסה",401)
        if role:
            require(s["role"]==role,"אין הרשאה לפעולה",403)
        if s["role"]=="student":
            st = db.execute("SELECT active FROM students WHERE id=?",(s["student_id"],)).fetchone()
            require(st and st["active"],"החשבון אינו פעיל",403)
        if request.method=="POST":
            require(hmac.compare_digest(request.headers.get("X-CSRF-Token",""),s["csrf"]),"רעננו את העמוד ונסו שוב",403)
        return s

    def make_session(db,role,sid=None):
        token, csrf = secrets.token_urlsafe(32),secrets.token_urlsafe(24)
        db.execute("DELETE FROM sessions WHERE token_hash=?",(digest(request.cookies.get("session","")),))
        db.execute("INSERT INTO sessions VALUES(?,?,?,?,?)",(digest(token),sid,role,csrf,now()+8*3600))
        response = jsonify(role=role,csrf=csrf,student_id=sid)
        response.set_cookie("session",token,max_age=8*3600,httponly=True,secure=app.config["COOKIE_SECURE"],samesite="Strict")
        return response

    @app.route("/api/login",methods=["POST"])
    def login():
        origin = request.headers.get("Origin")
        require(not origin or origin==request.host_url.rstrip("/"),"מקור בקשה לא תקין",403)
        body = request.get_json(silent=True) or {}
        require(isinstance(body,dict),"מבנה בקשה לא תקין")
        role = body.get("role","school")
        require(role in ("school","admin"),"סוג כניסה לא תקין")
        password = body.get("password","")
        require(isinstance(password,str) and len(password)<=500,"סיסמה לא תקינה")
        with transaction(app.config["DATABASE_PATH"]) as db:
            key = digest(str(request.remote_addr)+role)
            limit = db.execute("SELECT * FROM login_limits WHERE key=?",(key,)).fetchone()
            if limit and limit["until_at"]>now() and limit["attempts"]>=30:
                return jsonify(error="בוצעו ניסיונות רבים. נסו שוב בעוד 15 דקות."),429
            good = hmac.compare_digest(password.encode(),app.config["ADMIN_PASSWORD" if role=="admin" else "SCHOOL_CODE"].encode())
            if not good:
                count = limit["attempts"]+1 if limit and limit["until_at"]>now() else 1
                until = limit["until_at"] if limit and limit["until_at"]>now() else now()+900
                db.execute("INSERT OR REPLACE INTO login_limits VALUES(?,?,?)",(key,count,until))
                return jsonify(error="הקוד או הסיסמה אינם נכונים"),401
            db.execute("DELETE FROM login_limits WHERE key=?",(key,))
            return make_session(db,role)

    @app.route("/api/<path:route>",methods=["GET","POST"])
    def api(route):
        with transaction(app.config["DATABASE_PATH"]) as db:
            s = session(db)
            b = request.get_json(silent=True) or {}
            require(isinstance(b,dict),"מבנה בקשה לא תקין")
            if route=="me" and request.method=="GET":
                return jsonify(role=s["role"],student_id=s["student_id"],csrf=s["csrf"])
            if route=="logout" and request.method=="POST":
                db.execute("DELETE FROM sessions WHERE token_hash=?",(s["token_hash"],))
                resp=jsonify(ok=True)
                resp.delete_cookie("session")
                return resp
            if route=="roster" and request.method=="GET":
                return jsonify(classes=[dict(r) for r in db.execute("SELECT * FROM classes ORDER BY name")],
                               students=[dict(r) for r in db.execute("SELECT id,name,class_id FROM students WHERE active=1 ORDER BY name")])
            if route=="select" and request.method=="POST":
                require(s["role"] in ("school","student"),"כניסה זו מיועדת לתלמידים",403)
                sid=b.get("student_id")
                require(db.execute("SELECT 1 FROM students WHERE id=? AND active=1",(sid,)).fetchone(),"התלמיד לא נמצא")
                return make_session(db,"student",sid)
            if route=="state" and request.method=="GET":
                rnd=active_round(db) or db.execute("SELECT * FROM rounds ORDER BY number DESC LIMIT 1").fetchone()
                complete=[r[0] for r in db.execute("SELECT mishnah_id FROM completions WHERE round_id=? AND revoked_at IS NULL",(rnd["id"],))]
                statuses={r["mishnah_id"]:r["status"] for r in db.execute("SELECT mishnah_id,status FROM content")}
                tickets=db.execute("SELECT COALESCE(SUM(delta),0) FROM tickets WHERE student_id=?",(s["student_id"],)).fetchone()[0]
                return jsonify(structure=STRUCTURE,total=TOTAL,round=dict(rnd),completed=complete,statuses=statuses,my_tickets=tickets)
            if route=="board" and request.method=="GET":
                students=[dict(r) for r in db.execute("""SELECT s.id,s.name,c.name AS class_name,COALESCE(SUM(t.delta),0) AS tickets
                    FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN tickets t ON t.student_id=s.id
                    WHERE s.active=1 GROUP BY s.id ORDER BY c.name,s.name""")]
                classes=[dict(r) for r in db.execute("""SELECT c.id,c.name,count(x.id) AS contribution FROM classes c
                    LEFT JOIN completions x ON x.class_id=c.id AND x.revoked_at IS NULL GROUP BY c.id ORDER BY c.name""")]
                recent=[dict(r) for r in db.execute("""SELECT c.name AS class_name,m.tractate,x.completed_at FROM completions x
                    JOIN classes c ON c.id=x.class_id JOIN mishnayot m ON m.id=x.mishnah_id
                    WHERE x.revoked_at IS NULL ORDER BY x.id DESC LIMIT 10""")]
                return jsonify(students=students,classes=classes,recent=recent)
            if route in ("learn","question","answer","release") and request.method=="POST":
                require(s["role"]=="student","יש לבחור כיתה ושם לפני הלימוד",403)
                sid=s["student_id"]
                if route=="learn":
                    l=acquire(db,sid,b.get("id"))
                    return jsonify(id=l["id"],mishnah_id=l["mishnah_id"],text=l["text"],expires_at=l["expires_at"])
                if route=="question":
                    return jsonify(challenge(db,b.get("id"),sid))
                if route=="answer":
                    return jsonify(answer(db,b.get("id"),sid,b.get("option")))
                l=owned_lease(db,b.get("id"),sid)
                db.execute("UPDATE leases SET result='released' WHERE id=? AND result IS NULL",(l["id"],))
                return jsonify(ok=True)
            require(route.startswith("admin/") and s["role"]=="admin","אין הרשאה לפעולה",403)
            if route=="admin/data" and request.method=="GET":
                data={}
                for table in ("rounds","classes","students","settings"):
                    data[table]=[dict(r) for r in db.execute("SELECT * FROM "+table)]
                data["completions"]=[dict(r) for r in db.execute("SELECT * FROM completions ORDER BY id DESC")]
                data["tickets"]=[dict(r) for r in db.execute("SELECT * FROM tickets ORDER BY id DESC")]
                data["audit"]=[dict(r) for r in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 200")]
                data["content"]=[dict(r) for r in db.execute("SELECT * FROM content")]
                return jsonify(data)
            if route=="admin/import" and request.method=="POST":
                kind=b.get("kind")
                rows=b.get("rows")
                require(kind in ("content","students"),"סוג ייבוא לא תקין")
                report=validate_content(rows,b.get("full") is True) if kind=="content" else import_students(db,rows)
                if not report["errors"] and b.get("apply") is True:
                    if kind=="content":
                        apply_content(db,rows)
                    else:
                        import_students(db,rows,True)
                    record(db,"import",{"kind":kind,"count":len(rows)})
                    report["applied"]=True
                return jsonify(report)
            if route=="admin/settings" and request.method=="POST":
                for key,low,high in (("cooldown_seconds",1,86400),("lease_seconds",60,3600)):
                    value=b.get(key)
                    require(type(value)==int and low<=value<=high,"זמן מחוץ לטווח המותר")
                    db.execute("UPDATE settings SET value=? WHERE key=?",(str(value),key))
                record(db,"settings",b)
                return jsonify(ok=True)
            if route=="admin/ticket" and request.method=="POST":
                sid=b.get("student_id")
                require(db.execute("SELECT 1 FROM students WHERE id=?",(sid,)).fetchone(),"תלמיד לא נמצא")
                require(type(b.get("delta"))==int and b["delta"] in (-1,1),"יש לבחור הוספה או הסרה של כרטיס אחד")
                reason=b.get("reason","")
                require(isinstance(reason,str) and 1<=len(reason.strip())<=300,"יש לציין סיבת תיקון")
                balance=db.execute("SELECT COALESCE(SUM(delta),0) FROM tickets WHERE student_id=?",(sid,)).fetchone()[0]
                require(balance+b["delta"]>=0,"לא ניתן ליצור יתרת כרטיסים שלילית")
                db.execute("INSERT INTO tickets(student_id,delta,reason,created_at) VALUES(?,?,?,?)",(sid,b["delta"],reason,now()))
                record(db,"ticket",b)
                return jsonify(ok=True)
            if route=="admin/revoke" and request.method=="POST":
                x=db.execute("SELECT * FROM completions WHERE id=? AND revoked_at IS NULL",(b.get("id"),)).fetchone()
                require(x is not None,"השלמה לא נמצאה או כבר בוטלה")
                # History remains; closed rounds never reopen implicitly.
                bal=db.execute("SELECT COALESCE(SUM(delta),0) FROM tickets WHERE student_id=?",(x["student_id"],)).fetchone()[0]
                require(bal>0,"אין כרטיס להפחתה. תקנו תחילה את יתרת התלמיד.")
                db.execute("UPDATE completions SET revoked_at=? WHERE id=?",(now(),x["id"]))
                db.execute("INSERT INTO tickets(student_id,delta,reason,created_at) VALUES(?,-1,?,?)",(x["student_id"],"ביטול השלמה "+str(x["id"]),now()))
                record(db,"revoke",{"id":x["id"]})
                return jsonify(ok=True)
            if route=="admin/student" and request.method=="POST":
                require(type(b.get("active"))==int and b["active"] in (0,1),"מצב לא תקין")
                db.execute("UPDATE students SET active=? WHERE id=?",(b["active"],b.get("id")))
                db.execute("DELETE FROM sessions WHERE student_id=?",(b.get("id"),))
                db.execute("UPDATE leases SET result='released' WHERE student_id=? AND result IS NULL",(b.get("id"),))
                record(db,"student",b)
                return jsonify(ok=True)
            if route=="admin/round" and request.method=="POST":
                require(active_round(db) is None,"ניתן לפתוח סבב נוסף רק אחרי סיום הסבב הפעיל")
                number=new_round(db)
                record(db,"round",{"number":number})
                return jsonify(number=number)
            if route=="admin/export" and request.method=="GET":
                kind=request.args.get("kind","tickets")
                if kind=="content":
                    rows=[{"id":r["mishnah_id"],"text":r["text"],"status":r["status"],"questions":json.loads(r["questions"])} for r in db.execute("SELECT * FROM content ORDER BY mishnah_id")]
                    resp=make_response(json.dumps(rows,ensure_ascii=False,indent=2))
                    resp.headers["Content-Type"]="application/json; charset=utf-8"
                    resp.headers["Content-Disposition"]='attachment; filename="content.json"'
                    return resp
                if kind in ("tickets","raffle"):
                    rows=[dict(r) for r in db.execute("""SELECT s.id,s.name,c.name AS class_name,COALESCE(SUM(t.delta),0) AS tickets
                        FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN tickets t ON t.student_id=s.id GROUP BY s.id ORDER BY c.name,s.name""")]
                    if kind=="raffle":
                        require(sum(r["tickets"] for r in rows)<=1000000,"הייצוא גדול מדי")
                        rows=[r for r in rows for _ in range(r["tickets"])]
                    columns=["id","name","class_name"]+([] if kind=="raffle" else ["tickets"])
                elif kind=="students":
                    rows=[dict(r) for r in db.execute("SELECT s.id,s.name,s.class_id,c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id")]
                    columns=["id","name","class_id","class_name"]
                elif kind=="completions":
                    rows=[dict(r) for r in db.execute("SELECT * FROM completions")]
                    columns=["id","round_id","mishnah_id","student_id","class_id","completed_at","revoked_at","content_revision"]
                elif kind=="classes":
                    rows=[dict(r) for r in db.execute("SELECT c.id,c.name,count(x.id) AS contribution FROM classes c LEFT JOIN completions x ON x.class_id=c.id AND x.revoked_at IS NULL GROUP BY c.id")]
                    columns=["id","name","contribution"]
                else:
                    raise GameError("סוג ייצוא לא תקין")
                resp=make_response(csv_output(columns,rows))
                resp.headers["Content-Type"]="text/csv; charset=utf-8"
                resp.headers["Content-Disposition"]='attachment; filename="'+kind+'.csv"'
                return resp
            raise GameError("הפעולה לא נמצאה",404)
    return app

if os.environ.get("ADMIN_PASSWORD") and os.environ.get("SCHOOL_CODE"):
    app=create_app()

if __name__=="__main__":
    app=create_app()
    app.run(host="0.0.0.0",port=int(os.getenv("PORT","8000")),debug=False)
