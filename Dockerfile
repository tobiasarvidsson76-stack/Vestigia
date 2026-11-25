FROM python:3.12-slim
WORKDIR /app
COPY requirements-postgres.txt requirements-billing.txt ./
RUN pip install --no-cache-dir -r requirements-postgres.txt
COPY billing.py catalog.py catalog_v1.json database.py game.py live_world.py local_maps.py pedestrian.py save_format.py server.py ./
COPY migrations migrations
COPY static static
EXPOSE 8080
CMD ["python", "server.py"]
