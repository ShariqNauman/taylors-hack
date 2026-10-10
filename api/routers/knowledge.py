"""
EarlyEye API — Knowledge Bank & pgvector Search Router (CUT List #1)

Provides access to legal statutes (Penal Code s.507), KPM bullying guidelines,
hostel warden procedures, and de-escalation protocols via vector semantic search.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from api.models import KnowledgeCreate, KnowledgeDoc, KnowledgeSearchQuery
from api.services.knowledge_service import knowledge_service

router = APIRouter(prefix="", tags=["knowledge"])


@router.get("/knowledge", response_model=list[KnowledgeDoc])
def list_knowledge(category: Optional[str] = Query(default=None)):
    """List safety standards and operational SOPs, optionally filtered by category."""
    return knowledge_service.list_documents(category=category)


@router.post("/knowledge", response_model=KnowledgeDoc, status_code=201)
def create_knowledge_document(body: KnowledgeCreate):
    """Add a new SOP, policy, or legal guideline with vector embedding."""
    return knowledge_service.add_document(body)


@router.post("/knowledge/search", response_model=list[KnowledgeDoc])
def search_knowledge(query: KnowledgeSearchQuery):
    """
    Perform vector semantic search over safety documents.
    Uses pgvector cosine similarity in Supabase or local embedding projection.
    """
    cat_val = query.category.value if query.category else None
    return knowledge_service.search(
        query=query.query,
        category=cat_val,
        limit=query.limit,
        match_threshold=query.match_threshold,
    )


@router.post("/knowledge/seed", tags=["knowledge"])
def seed_knowledge_bank():
    """Seed curated Malaysian safety and legal corpus into Supabase knowledge_documents table."""
    knowledge_service.seed_supabase_if_available()
    return {"status": "ok", "message": "Curated safety corpus verified and synchronized"}
