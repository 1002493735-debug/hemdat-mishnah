FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -m app && mkdir /data && chown app:app /data
COPY . .
USER app
ENV DATABASE_PATH=/data/game.db COOKIE_SECURE=1
EXPOSE 8000
CMD ["gunicorn","--bind","0.0.0.0:8000","--workers","1","--threads","8","--timeout","60","server:app"]
