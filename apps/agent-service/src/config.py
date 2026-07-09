import os

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "password")

# LLM for Graphiti's episode extraction — any OpenAI-compatible endpoint
# (OpenAI itself, DeepSeek, Groq, a local server). Graphiti's default
# client hard-requires OPENAI_API_KEY at init; these let the same key/model
# flexibility the gateway's provider registry has apply here too.
LLM_API_KEY = os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
LLM_BASE_URL = os.environ.get("OPENAI_BASE_URL") or os.environ.get("LLM_BASE_URL")
LLM_MODEL = os.environ.get("LLM_MODEL")
