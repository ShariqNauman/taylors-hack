"""
EarlyEye API — Multi-Site Management Router (CUT List #6)

Enables EarlyEye to scale across multiple locations:
1. Universities & Campuses (e.g. Taylor's Lakeside)
2. Government Boarding School Hostels (e.g. SMK Asrama 533-site programme)
3. Commercial Malls & Transit Hubs (e.g. IOI Mall Puchong)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.db import get_supabase
from api.models import Site, SiteType, Zone

router = APIRouter(prefix="", tags=["multi-site"])

# Additional default multi-site profiles
MULTI_SITES = [
    {
        "site_id": "TAYLORS-LK",
        "name": "Taylor's Lakeside Campus",
        "site_type": "campus",
        "zones": [
            {"zone_type": "hostel_corridor", "label": "Asrama Puteri, koridor tingkat 3", "risk": 1.0},
            {"zone_type": "stairwell", "label": "Block C stairwell", "risk": 0.8},
            {"zone_type": "canteen", "label": "Canteen", "risk": 0.7},
            {"zone_type": "car_park", "label": "Car Park A", "risk": 0.6},
            {"zone_type": "sports_court", "label": "Sports Court", "risk": 0.3},
        ],
    },
    {
        "site_id": "SMK-TAMAN-ASR",
        "name": "SMK Taman Melati (Hostel Blok Putra)",
        "site_type": "school",
        "zones": [
            {"zone_type": "dorm_corridor", "label": "Dormitory L2 Hallway", "risk": 1.0},
            {"zone_type": "washroom_area", "label": "Bilik Air & Basuh Aras 1", "risk": 0.95},
            {"zone_type": "dining_hall", "label": "Dewan Makan Asrama", "risk": 0.6},
            {"zone_type": "study_room", "label": "Bilik Prep / Belajar", "risk": 0.4},
        ],
    },
    {
        "site_id": "IOI-MALL-PJ",
        "name": "IOI Mall Puchong (Retail & Transit Concourse)",
        "site_type": "mall",
        "zones": [
            {"zone_type": "loading_bay", "label": "Basement Loading Bay B2", "risk": 0.85},
            {"zone_type": "taxi_stand", "label": "Main Concourse Drop-off & Taxi Stand", "risk": 0.7},
            {"zone_type": "cinema_lobby", "label": "L3 Cinema & Arcade Corridor", "risk": 0.65},
            {"zone_type": "food_court", "label": "LG Oasis Food Hall", "risk": 0.4},
        ],
    },
]


@router.get("/sites", response_model=list[Site])
def list_all_sites():
    """List all deployed customer sites under the EarlyEye umbrella."""
    sb = get_supabase()
    try:
        res = sb.table("sites").select("*").execute()
        db_sites = res.data or []
        if len(db_sites) > 1:
            # Format with zones
            out = []
            for s in db_sites:
                z_res = sb.table("zones").select("*").eq("site_id", s["site_id"]).execute()
                zones = [Zone(zone_type=z["zone_type"], label=z["label"], risk=z["risk"]) for z in (z_res.data or [])]
                out.append(Site(site_id=s["site_id"], name=s["name"], site_type=s["site_type"], zones=zones))
            return out
    except Exception:
        pass

    # Fallback to multi-site catalog
    return [
        Site(
            site_id=s["site_id"],
            name=s["name"],
            site_type=SiteType(s["site_type"]),
            zones=[Zone(**z) for z in s["zones"]],
        )
        for s in MULTI_SITES
    ]


@router.post("/sites", response_model=Site, status_code=201)
def create_site(site: Site):
    """Register a new campus, school, or commercial facility into the EarlyEye network."""
    sb = get_supabase()
    try:
        sb.table("sites").upsert(
            {"site_id": site.site_id, "name": site.name, "site_type": site.site_type.value},
            on_conflict="site_id",
        ).execute()
        for z in site.zones:
            sb.table("zones").insert(
                {"site_id": site.site_id, "zone_type": z.zone_type, "label": z.label, "risk": z.risk}
            ).execute()
    except Exception:
        pass

    return site
