import json
import os
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from server import create_app, transaction, acquire, challenge, answer, GameError, validate_content, apply_content, TOTAL

class GameTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.tmp.name)/"test.db")
        self.app=create_app({"TESTING":True,"DATABASE_PATH":self.path,"ADMIN_PASSWORD":"test-only-password","SCHOOL_CODE":"test-only-code","COOKIE_SECURE":False})
    def tearDown(self):
        self.tmp.cleanup()
    def tx(self):
        return transaction(self.path)
    def lease(self,sid="demo-1",mid="rosh-hashanah:2:2"):
        with self.tx() as db:
            return acquire(db,sid,mid)
    def right(self,l,sid="demo-1"):
        with self.tx() as db:
            challenge(db,l["id"],sid)
            q=json.loads(db.execute("SELECT challenge FROM leases WHERE id=?",(l["id"],)).fetchone()[0])
            return q["correct_id"]
    def finish(self,l,sid="demo-1",option=None):
        option=option or self.right(l,sid)
        with self.tx() as db:
            return answer(db,l["id"],sid,option)
    def test_canonical_structure(self):
        with self.tx() as db:
            self.assertEqual(TOTAL,149)
            self.assertEqual(db.execute("SELECT count(*) FROM chapters").fetchone()[0],17)
            self.assertEqual(db.execute("SELECT count(*) FROM mishnayot").fetchone()[0],149)
            self.assertEqual(db.execute("SELECT count(*) FROM content WHERE status='ready'").fetchone()[0],149)
    def test_parallel_acquisition(self):
        def run(sid):
            try:return self.lease(sid)["id"]
            except GameError:return None
        with ThreadPoolExecutor(4) as pool:
            results=list(pool.map(run,["demo-1","demo-2","demo-3","demo-4"]))
        self.assertEqual(sum(x is not None for x in results),1)
    def test_duplicate_submission_awards_once(self):
        l=self.lease();option=self.right(l)
        with ThreadPoolExecutor(8) as pool:
            results=list(pool.map(lambda _:self.finish(l,option=option),range(8)))
        self.assertTrue(all(r["result"]=="correct" for r in results))
        with self.tx() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM completions").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT sum(delta) FROM tickets").fetchone()[0],1)
    def test_cooldown_survives_new_connection_other_student_can_learn(self):
        l=self.lease()
        with self.tx() as db:
            q=challenge(db,l["id"],"demo-1")
            correct=json.loads(db.execute("SELECT challenge FROM leases WHERE id=?",(l["id"],)).fetchone()[0])["correct_id"]
            wrong=next(o["id"] for o in q["options"] if o["id"]!=correct)
            self.assertEqual(answer(db,l["id"],"demo-1",wrong)["result"],"wrong")
        with self.assertRaises(GameError):self.lease()
        l2=self.lease("demo-2")
        self.finish(l2,"demo-2")
        with self.assertRaises(GameError):self.lease("demo-3")
    def test_expired_lease_cannot_win_after_other_student(self):
        l=self.lease();option=self.right(l)
        with self.tx() as db:db.execute("UPDATE leases SET expires_at=0 WHERE id=?",(l["id"],))
        other=self.lease("demo-2");self.finish(other,"demo-2")
        self.assertEqual(self.finish(l,option=option)["result"],"taken")
        with self.tx() as db:self.assertEqual(db.execute("SELECT sum(delta) FROM tickets").fetchone()[0],1)
    def test_answers_not_exposed_and_order_varies(self):
        positions=set()
        for _ in range(30):
            l=self.lease()
            with self.tx() as db:
                q=challenge(db,l["id"],"demo-1")
                self.assertNotIn("correct_id",q)
                secret=json.loads(db.execute("SELECT challenge FROM leases WHERE id=?",(l["id"],)).fetchone()[0])["correct_id"]
                positions.add(next(i for i,o in enumerate(q["options"]) if o["id"]==secret))
                db.execute("UPDATE leases SET result='released' WHERE id=?",(l["id"],))
        self.assertGreater(len(positions),1)
    def test_validation_and_import_preserve_game(self):
        l=self.lease();self.finish(l)
        with self.tx() as db:
            r=db.execute("SELECT * FROM content WHERE mishnah_id=?",(l["mishnah_id"],)).fetchone()
            row={"id":r["mishnah_id"],"text":r["text"],"status":"ready","questions":json.loads(r["questions"])}
            self.assertEqual(validate_content([row])["errors"],[])
            self.assertTrue(validate_content([row,row])["errors"])
            self.assertTrue(validate_content([{"id":"invalid"}])["errors"])
            self.assertTrue(validate_content([row],True)["errors"])
            bad=json.loads(json.dumps(row));bad["questions"][0]["correct"]="missing"
            self.assertTrue(validate_content([bad])["errors"])
            bad=json.loads(json.dumps(row));bad["questions"][0]["options"].pop()
            self.assertTrue(validate_content([bad])["errors"])
            bad=json.loads(json.dumps(row));bad["questions"].pop()
            self.assertTrue(validate_content([bad])["errors"])
            apply_content(db,[row])
            self.assertEqual(db.execute("SELECT count(*) FROM completions").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT sum(delta) FROM tickets").fetchone()[0],1)
    def test_last_completion_starts_bonus_preserves_history(self):
        l=self.lease()
        with self.tx() as db:
            for mid, in db.execute("SELECT id FROM mishnayot WHERE id<>?",(l["mishnah_id"],)).fetchall():
                db.execute("INSERT INTO completions(round_id,mishnah_id,student_id,class_id,completed_at,content_revision) VALUES(1,?,'demo-2','demo-a',1,1)",(mid,))
        r=self.finish(l)
        self.assertTrue(r["all_completed"])
        self.assertEqual(r["bonus_round"],2)
        with self.tx() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM completions WHERE round_id=1").fetchone()[0],149)
            self.assertEqual(db.execute("SELECT number FROM rounds WHERE finished_at IS NULL").fetchone()[0],2)
        self.lease("demo-3")
    def test_api_authentication_csrf_and_student_flow(self):
        client=self.app.test_client()
        self.assertEqual(client.get("/api/roster").status_code,401)
        self.assertEqual(client.get("/api/admin/export").status_code,401)
        r=client.post("/api/login",json={"role":"school","password":"test-only-code"}).get_json()
        self.assertEqual(client.post("/api/select",json={"student_id":"demo-1"}).status_code,403)
        r=client.post("/api/select",json={"student_id":"demo-1"},headers={"X-CSRF-Token":r["csrf"]}).get_json()
        self.assertEqual(r["role"],"student")
        self.assertEqual(client.get("/api/admin/data").status_code,403)
        h={"X-CSRF-Token":r["csrf"]}
        l=client.post("/api/learn",json={},headers=h).get_json()
        self.assertNotIn("questions",l)
        self.assertNotIn("correct",json.dumps(l))
        q=client.post("/api/question",json={"id":l["id"]},headers=h).get_json()
        self.assertEqual(len(q["options"]),4)
        with self.tx() as db:
            correct=json.loads(db.execute("SELECT challenge FROM leases WHERE id=?",(l["id"],)).fetchone()[0])["correct_id"]
        response=client.post("/api/answer",json={"id":l["id"],"option":correct},headers=h)
        self.assertEqual(response.get_json()["result"],"correct")
        self.assertEqual(client.get("/api/state").get_json()["my_tickets"],1)
    def test_admin_revoke_and_export(self):
        self.finish(self.lease())
        client=self.app.test_client()
        r=client.post("/api/login",json={"role":"admin","password":"test-only-password"}).get_json()
        h={"X-CSRF-Token":r["csrf"]}
        response=client.post("/api/admin/revoke",json={"id":1},headers=h)
        self.assertEqual(response.status_code,200)
        self.assertEqual(client.post("/api/admin/revoke",json={"id":1},headers=h).status_code,400)
        with self.tx() as db:
            self.assertEqual(db.execute("SELECT sum(delta) FROM tickets").fetchone()[0],0)
        self.assertEqual(client.get("/api/admin/export?kind=raffle").status_code,200)

if __name__=="__main__":
    unittest.main()
