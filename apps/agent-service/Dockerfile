FROM python:3.11-slim
WORKDIR /app
COPY apps/agent-service/pyproject.toml .
RUN pip install --no-cache-dir -e .
COPY apps/agent-service/src/ src/
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
