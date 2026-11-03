"""Display names and colours for drivers, teams, circuits and Grands Prix."""

from __future__ import annotations

CIRCUIT_NAMES = {
    "austin": "Circuit of the Americas",
    "bahrain": "Bahrain",
    "baku": "Baku",
    "catalunya": "Barcelona-Catalunya",
    "hungaroring": "Hungaroring",
    "imola": "Imola",
    "interlagos": "Interlagos",
    "istanbul": "Istanbul Park",
    "jeddah": "Jeddah",
    "las-vegas": "Las Vegas",
    "lusail": "Lusail",
    "madring": "Madring",
    "marina-bay": "Marina Bay",
    "melbourne": "Albert Park",
    "mexico-city": "Mexico City",
    "miami": "Miami",
    "monaco": "Monaco",
    "montreal": "Montréal",
    "monza": "Monza",
    "mugello": "Mugello",
    "nurburgring": "Nürburgring",
    "paul-ricard": "Paul Ricard",
    "portimao": "Portimão",
    "sepang": "Sepang",
    "shanghai": "Shanghai",
    "silverstone": "Silverstone",
    "sirius": "Sochi",
    "spa-francorchamps": "Spa-Francorchamps",
    "spielberg": "Red Bull Ring",
    "suzuka": "Suzuka",
    "yas-marina": "Yas Marina",
    "zandvoort": "Zandvoort",
}

TEAM_NAMES = {
    "alfa-romeo": "Alfa Romeo",
    "alphatauri": "AlphaTauri",
    "alpine": "Alpine",
    "audi": "Audi",
    "aston-martin": "Aston Martin",
    "cadillac": "Cadillac",
    "ferrari": "Ferrari",
    "haas": "Haas",
    "kick-sauber": "Kick Sauber",
    "mclaren": "McLaren",
    "mercedes": "Mercedes",
    "racing-bulls": "Racing Bulls",
    "racing-point": "Racing Point",
    "rb": "RB",
    "red-bull": "Red Bull",
    "renault": "Renault",
    "williams": "Williams",
}

# Team swatches (used only as small colour markers next to names).
TEAM_COLORS = {
    "alfa-romeo": "#9b0000",
    "alphatauri": "#2b4562",
    "alpine": "#2293d1",
    "audi": "#bb0a30",
    "aston-martin": "#229971",
    "cadillac": "#c8a45a",
    "ferrari": "#e8002d",
    "haas": "#9c9fa2",
    "kick-sauber": "#52e252",
    "mclaren": "#ff8000",
    "mercedes": "#27f4d2",
    "racing-bulls": "#6692ff",
    "racing-point": "#f596c8",
    "rb": "#6692ff",
    "red-bull": "#3671c6",
    "renault": "#fff500",
    "williams": "#64c4ff",
}

DRIVER_NAME_FIXES = {"carlos-sainz-jr": "Carlos Sainz", "nyck-de-vries": "Nyck de Vries", "guanyu-zhou": "Zhou Guanyu"}

GP_NAME_FIXES = {
    "united-states": "United States",
    "70th-anniversary": "70th Anniversary",
    "sao-paulo": "São Paulo",
    "emilia-romagna": "Emilia-Romagna",
}


def title(slug: str) -> str:
    return " ".join(w.capitalize() for w in str(slug).split("-"))


def driver_name(driver_id: str) -> str:
    return DRIVER_NAME_FIXES.get(driver_id, title(driver_id))


def team_name(team_id: str) -> str:
    return TEAM_NAMES.get(team_id, title(team_id))


def team_color(team_id: str) -> str:
    return TEAM_COLORS.get(team_id, "#888888")


def circuit_name(circuit_id: str) -> str:
    return CIRCUIT_NAMES.get(circuit_id, title(circuit_id))


def gp_name(gp_id: str) -> str:
    return GP_NAME_FIXES.get(gp_id, title(gp_id))
