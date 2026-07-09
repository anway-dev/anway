from fastapi import FastAPI
from .routes import episodes, facts
from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL

app = FastAPI(title="Anway Agent Service")
app.state.graphiti = None  # Initialized so patch.object has a target regardless of startup lifecycle

@app.on_event("startup")
async def startup():
    try:
        from graphiti_core import Graphiti
        # Graphiti's default OpenAIClient hard-requires OPENAI_API_KEY at
        # init — confirmed live: without one, init throws and every
        # episodes/facts call 503s ("Graphiti unavailable"). Pass an
        # explicit LLMConfig so any OpenAI-COMPATIBLE endpoint works
        # (DeepSeek/Groq/local), matching the gateway's model-agnostic
        # provider rule instead of hard-coupling to openai.com.
        llm_client = None
        if LLM_API_KEY:
            from graphiti_core.llm_client import LLMConfig, OpenAIClient
            llm_client = OpenAIClient(config=LLMConfig(
                api_key=LLM_API_KEY,
                base_url=LLM_BASE_URL,
                model=LLM_MODEL,
            ))
        app.state.graphiti = Graphiti(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, llm_client=llm_client)
        await app.state.graphiti.build_indices_and_constraints()
    except Exception as e:
        import logging
        logging.error(f"Graphiti init failed: {e}", exc_info=True)
        app.state.graphiti = None

app.include_router(episodes.router, prefix="/episodes")
app.include_router(facts.router, prefix="/facts")
