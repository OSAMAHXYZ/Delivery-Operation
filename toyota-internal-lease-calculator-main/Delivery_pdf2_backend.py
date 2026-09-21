from fastapi import FastAPI
import pandas as pd
from reportlab.pdfgen import canvas
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Excel
df = pd.read_excel("المرور  المحدث 2025-2026.xlsx")
df.columns = df.columns.str.strip()

data_dict = df.set_index("VIN").to_dict("index")


# Get car data
@app.get("/car/{vin}")
def get_car(vin: str):
    data = data_dict.get(vin)

    if not data:
        return {"error": "Not found"}

    return {
        "name": data.get("Customer Name", ""),
        "model": data.get("Model", ""),
        "color": data.get("Color", "")
    }


# Generate PDF
@app.get("/generate/{vin}")
def generate(vin: str):
    data = data_dict.get(vin)

    if not data:
        return {"error": "Not found"}

    file_name = f"{vin}.pdf"
    c = canvas.Canvas(file_name)

    c.drawString(100, 700, f"VIN: {vin}")
    c.drawString(100, 680, f"Name: {data.get('Customer Name','')}")
    c.drawString(100, 660, f"Model: {data.get('Model','')}")
    c.drawString(100, 640, f"Color: {data.get('Color','')}")

    c.save()

    return {"file": file_name}
