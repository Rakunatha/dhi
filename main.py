"""
Dhithra - AI-Native Research Document System
Single-file FastAPI backend: auth + documents + blocks + agents + static file serving
Uses OpenRouter free API (no cost) for all AI features
"""

import os, json, uuid, time, re
from datetime import datetime, timedelta
from typing import Optional, List, Any, Dict
from contextlib import asynccontextmanager

import httpx
import jwt
from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy import (
    Column, String, Text, DateTime, Integer, Float,
    ForeignKey, JSON, create_engine, select, func, text as sa_text
)
from sqlalchemy.dialects.sqlite import JSON as SQLJSON
from sqlalchemy.orm import DeclarativeBase, relationship, Session, sessionmaker
from dotenv import load_dotenv

load_dotenv()

# ─── Config ───────────────────────────────────────────────────────────────────

DATABASE_URL  = os.getenv("DATABASE_URL", "sqlite:///./dhithra.db")
JWT_SECRET    = os.getenv("JWT_SECRET", "dhithra-dev-secret-change-in-prod")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
# Free model on OpenRouter – swap for any free model you prefer
FREE_MODEL    = os.getenv("FREE_MODEL", "mistralai/mistral-7b-instruct:free")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
STATIC_DIR    = os.path.join(os.path.dirname(__file__), "static")
JWT_EXPIRE_H  = 72

# ─── Database ─────────────────────────────────────────────────────────────────

# Support both SQLite (dev/free tier) and PostgreSQL (Render paid)
if DATABASE_URL.startswith("postgresql"):
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name       = Column(String(255), nullable=False)
    email      = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    documents  = relationship("Document", back_populates="user", cascade="all, delete-orphan")
    analytics  = relationship("AnalyticsEvent", back_populates="user")


class Document(Base):
    __tablename__ = "documents"
    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String(36), ForeignKey("users.id"), nullable=False)
    title      = Column(String(500), default="Untitled Document")
    status     = Column(String(50),  default="draft")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user       = relationship("User", back_populates="documents")
    blocks     = relationship("Block", back_populates="document",
                              cascade="all, delete-orphan",
                              order_by="Block.order_index")


class Block(Base):
    __tablename__ = "blocks"
    id           = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id  = Column(String(36), ForeignKey("documents.id"), nullable=False)
    type         = Column(String(100), default="custom")
    content      = Column(Text, default="")
    block_meta   = Column(Text, default="{}")   # JSON stored as text (SQLite compat)
    order_index  = Column(Integer, default=0)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    document     = relationship("Document", back_populates="blocks")

    @property
    def metadata_dict(self):
        try: return json.loads(self.block_meta or "{}")
        except: return {}


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"
    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id         = Column(String(36), ForeignKey("users.id"), nullable=True)
    endpoint        = Column(String(500), nullable=False)
    method          = Column(String(10),  nullable=False)
    status_code     = Column(Integer, nullable=True)
    request_time_ms = Column(Float, nullable=True)
    timestamp       = Column(DateTime, default=datetime.utcnow, index=True)
    user            = relationship("User", back_populates="analytics")


def create_tables():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Auth helpers ─────────────────────────────────────────────────────────────

security = HTTPBearer()


def make_token(user_id: str, email: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_H)
    return jwt.encode({"sub": user_id, "email": email, "exp": exp},
                      JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


def current_user(
    creds: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(creds.credentials)
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user


def optional_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if not creds:
        return None
    try:
        payload = decode_token(creds.credentials)
        return db.query(User).filter(User.id == payload["sub"]).first()
    except Exception:
        return None


# ─── OpenRouter AI helpers ────────────────────────────────────────────────────

def _extract_json(text: str) -> Any:
    """Strip markdown fences and parse JSON."""
    clean = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    # Try direct parse
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        # Try extracting first [...] or {...}
        for pat in [r"(\[.*\])", r"(\{.*\})"]:
            m = re.search(pat, clean, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(1))
                except:
                    pass
    raise ValueError("No valid JSON found in response")


async def llm(system: str, user_msg: str, max_tokens: int = 2000) -> str:
    """Call OpenRouter with a free model and return text response."""
    if not OPENROUTER_API_KEY:
        raise HTTPException(500, "OPENROUTER_API_KEY not configured")

    payload = {
        "model": FREE_MODEL,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user_msg},
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://dhithra.onrender.com",
        "X-Title": "Dhithra Research Platform",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(502, f"OpenRouter error {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        return data["choices"][0]["message"]["content"]


# ─── Agent implementations ────────────────────────────────────────────────────

async def agent_generate(prompt: str, **_) -> dict:
    """Generate a full structured research document."""
    system = (
        "You are a research paper generation AI. "
        "Given a topic, produce a complete academic research document as a JSON array of blocks.\n"
        "Return ONLY valid JSON array, no markdown, no preamble.\n"
        'Format: [{"type":"abstract","content":"..."},{"type":"introduction","content":"..."},...]\n'
        "Include: abstract, introduction, methodology, results, discussion, conclusion, references.\n"
        "Each section should be 2-4 rich academic paragraphs. references content can be empty string."
    )
    raw = await llm(system, f"Topic: {prompt}", max_tokens=3000)
    try:
        blocks = _extract_json(raw)
        return {"blocks": blocks, "count": len(blocks)}
    except:
        return {"blocks": [{"type": "introduction", "content": raw}], "count": 1}


async def agent_think(prompt: str, **_) -> dict:
    """Analyze content and extract research insights."""
    system = (
        "You are a research analyst AI. Analyze the provided text and extract key insights.\n"
        "Return ONLY valid JSON:\n"
        '{"themes":["..."],"findings":["..."],"methodologies":["..."],"gaps":["..."],'
        '"suggested_angles":["..."],"summary":"2-3 sentence overview"}'
    )
    raw = await llm(system, f"Content to analyze:\n\n{prompt[:5000]}", max_tokens=1200)
    try:
        return _extract_json(raw)
    except:
        return {"summary": raw, "themes": [], "findings": [], "suggested_angles": []}


async def agent_structure(prompt: str, **_) -> dict:
    """Structure raw content into document blocks."""
    system = (
        "You are a document structuring AI. Organize the provided content into structured research blocks.\n"
        "Return ONLY valid JSON array:\n"
        '[{"type":"abstract","content":"..."},{"type":"introduction","content":"..."}]\n'
        "Types: abstract, introduction, literature_review, methodology, results, discussion, conclusion, references."
    )
    raw = await llm(system, f"Content to structure:\n\n{prompt}", max_tokens=3000)
    try:
        blocks = _extract_json(raw)
        return {"blocks": blocks, "count": len(blocks)}
    except:
        return {"blocks": [{"type": "custom", "content": raw}], "count": 1}


async def agent_reason(prompt: str, block_content: str = "", block_type: str = "custom", **_) -> dict:
    """Refine a block with reasoning."""
    system = (
        "You are a research writing improvement AI. "
        "Rewrite or improve the given document block according to the user instruction. "
        "Maintain academic tone and quality. Return ONLY the improved text content, no explanations."
    )
    user_msg = f"Block type: {block_type}\n\nCurrent content:\n{block_content}\n\nInstruction: {prompt}"
    improved = await llm(system, user_msg, max_tokens=1200)
    return {"content": improved.strip(), "block_type": block_type}


async def agent_research(prompt: str, **_) -> dict:
    """Research a topic and return context + citations."""
    system = (
        "You are an academic research assistant. Given a query, provide:\n"
        "1. Background context and explanation\n"
        "2. Key academic perspectives\n"
        "3. Related concepts\n"
        "4. Suggested database search terms\n"
        "5. 3-4 plausible APA citation suggestions\n"
        "Return ONLY valid JSON:\n"
        '{"context":"...","perspectives":["..."],"related_concepts":["..."],'
        '"search_terms":["..."],"suggested_citations":[{"apa":"full APA string","year":2024,"journal":"..."}]}'
    )
    raw = await llm(system, f"Research query: {prompt}", max_tokens=1800)
    try:
        return _extract_json(raw)
    except:
        return {"context": raw, "perspectives": [], "search_terms": [], "suggested_citations": []}


async def agent_cite(prompt: str, **_) -> dict:
    """Generate an APA citation from URL or metadata."""
    system = (
        "You are a citation formatting AI specializing in APA 7th edition. "
        "Given a URL, DOI, or source metadata, generate a properly formatted APA citation.\n"
        "Return ONLY valid JSON:\n"
        '{"apa":"Author, A. (Year). Title. Source. URL","type":"journal_article|book|website",'
        '"authors":["Last, First"],"year":2024,"title":"...","source":"..."}'
    )
    raw = await llm(system, f"Source: {prompt}", max_tokens=600)
    try:
        return _extract_json(raw)
    except:
        return {"apa": raw.strip(), "type": "unknown"}


AGENT_MAP = {
    "generate":  agent_generate,
    "think":     agent_think,
    "structure": agent_structure,
    "reason":    agent_reason,
    "research":  agent_research,
    "cite":      agent_cite,
}

# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    name: str
    email: str


class DocCreate(BaseModel):
    title: str = "Untitled Document"


class DocUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None


class BlockCreate(BaseModel):
    type: str = "custom"
    content: str = ""
    order_index: int = 0


class BlockUpdate(BaseModel):
    content: Optional[str] = None
    type: Optional[str] = None
    order_index: Optional[int] = None


class AgentRequest(BaseModel):
    agent: str
    prompt: str
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = {}


# ─── Serializers ──────────────────────────────────────────────────────────────

def ser_block(b: Block) -> dict:
    return {
        "id": b.id, "document_id": b.document_id,
        "type": b.type, "content": b.content,
        "order_index": b.order_index,
        "metadata": b.metadata_dict,
        "created_at": b.created_at.isoformat(),
        "updated_at": b.updated_at.isoformat() if b.updated_at else b.created_at.isoformat(),
    }


def ser_doc(d: Document, include_blocks=True) -> dict:
    base = {
        "id": d.id, "user_id": d.user_id, "title": d.title,
        "status": d.status,
        "created_at": d.created_at.isoformat(),
        "updated_at": d.updated_at.isoformat() if d.updated_at else d.created_at.isoformat(),
    }
    if include_blocks:
        base["blocks"] = [ser_block(b) for b in sorted(d.blocks, key=lambda x: x.order_index)]
    else:
        base["block_count"] = len(d.blocks)
    return base


def ser_user(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email,
            "created_at": u.created_at.isoformat()}


# ─── App factory ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    yield


app = FastAPI(title="Dhithra API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Analytics middleware ──────────────────────────────────────────────────────

@app.middleware("http")
async def analytics_middleware(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    ms = (time.monotonic() - start) * 1000

    if not request.url.path.startswith("/api"):
        return response

    user_id = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            p = jwt.decode(auth[7:], JWT_SECRET, algorithms=["HS256"])
            user_id = p.get("sub")
        except:
            pass

    try:
        db = SessionLocal()
        db.add(AnalyticsEvent(
            user_id=user_id,
            endpoint=request.url.path,
            method=request.method,
            status_code=response.status_code,
            request_time_ms=ms,
        ))
        db.commit()
        db.close()
    except:
        pass

    return response


# ═══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    """Login or auto-register with Name + Email."""
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user:
        user = User(name=payload.name, email=payload.email.lower())
        db.add(user)
        db.commit()
        db.refresh(user)
    token = make_token(user.id, user.email)
    return {"access_token": token, "token_type": "bearer", "user": ser_user(user)}


@app.get("/api/auth/me")
def get_me(user: User = Depends(current_user)):
    return ser_user(user)


# ─── Documents ────────────────────────────────────────────────────────────────

@app.get("/api/documents")
def list_docs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.user_id == user.id)\
              .order_by(Document.updated_at.desc()).all()
    return [ser_doc(d, include_blocks=False) for d in docs]


@app.post("/api/documents")
def create_doc(payload: DocCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = Document(user_id=user.id, title=payload.title)
    db.add(doc)
    db.flush()
    # Default starter blocks
    for i, t in enumerate(["abstract", "introduction", "references"]):
        db.add(Block(document_id=doc.id, type=t, content="", order_index=i))
    db.commit()
    db.refresh(doc)
    return ser_doc(doc)


@app.get("/api/documents/{doc_id}")
def get_doc(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    return ser_doc(doc)


@app.patch("/api/documents/{doc_id}")
def update_doc(doc_id: str, payload: DocUpdate,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if payload.title is not None:
        doc.title = payload.title
    if payload.status is not None:
        doc.status = payload.status
    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)
    return ser_doc(doc)


@app.delete("/api/documents/{doc_id}")
def delete_doc(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    db.delete(doc)
    db.commit()
    return {"message": "deleted"}


# ─── Blocks ───────────────────────────────────────────────────────────────────

def _doc_owned(doc_id: str, user: User, db: Session) -> Document:
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@app.post("/api/documents/{doc_id}/blocks")
def add_block(doc_id: str, payload: BlockCreate,
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    _doc_owned(doc_id, user, db)
    block = Block(document_id=doc_id, type=payload.type,
                  content=payload.content, order_index=payload.order_index)
    db.add(block)
    db.commit()
    db.refresh(block)
    return ser_block(block)


@app.patch("/api/blocks/{block_id}")
def update_block(block_id: str, payload: BlockUpdate,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    block = db.query(Block).filter(Block.id == block_id).first()
    if not block:
        raise HTTPException(404, "Block not found")
    _doc_owned(block.document_id, user, db)
    if payload.content is not None:
        block.content = payload.content
    if payload.type is not None:
        block.type = payload.type
    if payload.order_index is not None:
        block.order_index = payload.order_index
    block.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(block)
    return ser_block(block)


@app.delete("/api/blocks/{block_id}")
def delete_block(block_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    block = db.query(Block).filter(Block.id == block_id).first()
    if not block:
        raise HTTPException(404, "Block not found")
    _doc_owned(block.document_id, user, db)
    db.delete(block)
    db.commit()
    return {"message": "deleted"}


# ─── Agents ───────────────────────────────────────────────────────────────────

@app.post("/api/agents/run")
async def run_agent(payload: AgentRequest,
                    user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Route to the correct agent and optionally persist results."""
    agent_fn = AGENT_MAP.get(payload.agent)
    if not agent_fn:
        raise HTTPException(400, f"Unknown agent '{payload.agent}'. Available: {list(AGENT_MAP)}")

    # Build kwargs
    kwargs: Dict[str, Any] = {"prompt": payload.prompt, **(payload.context or {})}

    # For reason agent: fetch block content
    if payload.agent == "reason" and payload.block_id:
        block = db.query(Block).filter(Block.id == payload.block_id).first()
        if not block:
            raise HTTPException(404, "Block not found")
        kwargs["block_content"] = block.content
        kwargs["block_type"]    = block.type

    # Run agent
    try:
        result = await agent_fn(**kwargs)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Agent error: {str(e)}")

    # ── Apply results to DB ─────────────────────────────────────────────

    # generate / structure → replace blocks in document
    if payload.agent in ("generate", "structure") and payload.document_id:
        doc = db.query(Document).filter(
            Document.id == payload.document_id,
            Document.user_id == user.id
        ).first()
        if doc:
            for b in list(doc.blocks):
                db.delete(b)
            db.flush()
            for i, bd in enumerate(result.get("blocks", [])):
                db.add(Block(
                    document_id=payload.document_id,
                    type=bd.get("type", "custom"),
                    content=bd.get("content", ""),
                    order_index=i,
                ))
            doc.updated_at = datetime.utcnow()
            db.commit()

    # reason → update block content
    if payload.agent == "reason" and payload.block_id:
        block = db.query(Block).filter(Block.id == payload.block_id).first()
        if block:
            block.content    = result.get("content", block.content)
            block.updated_at = datetime.utcnow()
            db.commit()

    # cite → append to references block
    if payload.agent == "cite" and payload.document_id:
        ref_block = db.query(Block).filter(
            Block.document_id == payload.document_id,
            Block.type == "references"
        ).first()
        apa = result.get("apa", "")
        if ref_block:
            ref_block.content = (ref_block.content or "").strip() + ("\n\n" + apa if apa else "")
            ref_block.content = ref_block.content.strip()
            ref_block.updated_at = datetime.utcnow()
        else:
            db.add(Block(document_id=payload.document_id, type="references",
                         content=apa, order_index=999))
        db.commit()

    return {"agent": payload.agent, "status": "success", "result": result}


@app.get("/api/agents/list")
def list_agents():
    return [
        {"name": "generate",  "icon": "✦", "label": "Generate",  "desc": "Generate a full research paper"},
        {"name": "think",     "icon": "🧠", "label": "Think",     "desc": "Analyze content and extract insights"},
        {"name": "structure", "icon": "⊞",  "label": "Structure", "desc": "Structure content into blocks"},
        {"name": "reason",    "icon": "◈",  "label": "Reason",    "desc": "Refine a block with AI reasoning"},
        {"name": "research",  "icon": "⌕",  "label": "Research",  "desc": "Research a topic for context"},
        {"name": "cite",      "icon": "❝",  "label": "Cite",      "desc": "Generate APA citation"},
    ]


# ─── Analytics ────────────────────────────────────────────────────────────────

@app.get("/api/analytics/summary")
def analytics_summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(
        AnalyticsEvent.endpoint,
        AnalyticsEvent.method,
        func.count().label("count"),
        func.avg(AnalyticsEvent.request_time_ms).label("avg_ms"),
    ).group_by(AnalyticsEvent.endpoint, AnalyticsEvent.method)\
     .order_by(func.count().desc()).limit(20).all()
    return [{"endpoint": r.endpoint, "method": r.method,
             "count": r.count, "avg_ms": round(r.avg_ms or 0, 1)} for r in rows]


# ─── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Dhithra", "model": FREE_MODEL}


# ─── Serve React SPA ──────────────────────────────────────────────────────────
# In production the React build is copied into ./static/
# In dev the Vite dev server runs separately

if os.path.isdir(STATIC_DIR) and os.listdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        """Catch-all: serve index.html for client-side routing."""
        index = os.path.join(STATIC_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        return JSONResponse({"detail": "Frontend not built yet"}, 404)
