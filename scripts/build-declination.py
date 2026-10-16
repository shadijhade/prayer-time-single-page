"""Builds src/declination.json: magnetic declination on a grid, from NOAA's World Magnetic Model.

Phone compasses point to magnetic north; the Qibla compass adds the declination at the user's
city (app.js interpolates this grid) so that its heading, and so the Qibla, is from true north.

Usage: python scripts/build-declination.py path/to/WMM2025.COF [path/to/WMM2025_TestValues.txt]
The coefficients (WMMxxxxCOF.zip, with the test values) are at
https://www.ncei.noaa.gov/products/world-magnetic-model/wmm-coefficients
Given the test values, the model is first checked against NOAA's own results.
"""
import json
import math
import sys
from pathlib import Path

EPOCH = 2027.5  # Mid-way through the years WMM2025 is valid for (2025-2030)
SOUTH, NORTH, STEP = -60, 80, 5  # Grid latitudes, and the spacing in degrees; longitudes -180..180
OUTPUT = Path(__file__).resolve().parent.parent / "src" / "declination.json"

# WGS 84 ellipsoid and the model's reference radius, km
A = 6378.137
F = 1 / 298.257223563
E2 = F * (2 - F)
EARTH_RADIUS = 6371.2


def read_model(path):
    """Epoch, model name and {(n, m): (g, h, g per year, h per year)} from a .COF file."""
    lines = Path(path).read_text().splitlines()
    epoch, name = float(lines[0].split()[0]), lines[0].split()[1]
    coefficients = {}
    for line in lines[1:]:
        fields = line.split()
        if len(fields) != 6:
            break  # The 999... end lines
        n, m = int(fields[0]), int(fields[1])
        coefficients[n, m] = tuple(map(float, fields[2:]))
    return epoch, name, coefficients


def declination(model, latitude, longitude, height_km, year):
    """Declination in degrees (east positive), as the WMM report's equations give it."""
    epoch, _, coefficients = model
    degree = max(n for n, _ in coefficients)
    phi, lam = math.radians(latitude), math.radians(longitude)

    # Geodetic to geocentric spherical coordinates
    rc = A / math.sqrt(1 - E2 * math.sin(phi) ** 2)
    p = (rc + height_km) * math.cos(phi)
    z = (rc * (1 - E2) + height_km) * math.sin(phi)
    r = math.hypot(p, z)
    phi_c = math.asin(z / r)
    ct, st = math.sin(phi_c), math.cos(phi_c)  # Cosine and sine of the colatitude

    # Associated Legendre functions (Gauss-normalised) and their colatitude derivatives, then
    # the factors that make them Schmidt semi-normalised as the coefficients are
    P, dP, S = {(0, 0): 1.0}, {(0, 0): 0.0}, {(0, 0): 1.0}
    for n in range(1, degree + 1):
        for m in range(n + 1):
            if n == m:
                P[n, m] = st * P[n - 1, m - 1]
                dP[n, m] = st * dP[n - 1, m - 1] + ct * P[n - 1, m - 1]
            else:
                k = ((n - 1) ** 2 - m ** 2) / ((2 * n - 1) * (2 * n - 3)) if n > 1 else 0
                P[n, m] = ct * P[n - 1, m] - k * P.get((n - 2, m), 0)
                dP[n, m] = ct * dP[n - 1, m] - st * P[n - 1, m] - k * dP.get((n - 2, m), 0)
        S[n, 0] = S[n - 1, 0] * (2 * n - 1) / n
        for m in range(1, n + 1):
            S[n, m] = S[n, m - 1] * math.sqrt((n - m + 1) * (2 if m == 1 else 1) / (n + m))

    # The field's north, east and down components in the geocentric frame
    north = east = down = 0.0
    for (n, m), (g, h, g_rate, h_rate) in coefficients.items():
        g = S[n, m] * (g + (year - epoch) * g_rate)
        h = S[n, m] * (h + (year - epoch) * h_rate)
        scale = (EARTH_RADIUS / r) ** (n + 2)
        cos_m, sin_m = math.cos(m * lam), math.sin(m * lam)
        north += scale * (g * cos_m + h * sin_m) * dP[n, m]
        east += scale * m * (g * sin_m - h * cos_m) * P[n, m]
        down -= scale * (n + 1) * (g * cos_m + h * sin_m) * P[n, m]
    east /= st  # ponytail: undefined at the geographic poles, which the grid stops short of

    # Rotated to the ellipsoid; east is unchanged
    psi = phi_c - phi
    north_geodetic = north * math.cos(psi) - down * math.sin(psi)
    return math.degrees(math.atan2(east, north_geodetic))


def check(model, test_values):
    """Exits with an error unless every NOAA test point agrees to 0.01 degree."""
    worst = 0
    for line in Path(test_values).read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        year, height, latitude, longitude, expected = map(float, line.split()[:5])
        worst = max(worst, abs(declination(model, latitude, longitude, height, year) - expected))
    print(f"Test values: largest difference {worst:.4f} degrees")
    if worst > 0.01:
        sys.exit("The model doesn't match NOAA's test values")


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    model = read_model(sys.argv[1])
    if len(sys.argv) == 3:
        check(model, sys.argv[2])

    latitudes = range(SOUTH, NORTH + 1, STEP)
    longitudes = range(-180, 181, STEP)
    tenths = [[round(declination(model, lat, lon, 0, EPOCH) * 10) for lon in longitudes] for lat in latitudes]

    # How far the app's bilinear interpolation strays from the model between grid points
    worst = 0
    for lat in range(-55, 61):
        for lon in range(-180, 180, 2):
            row, column = (lat - SOUTH) / STEP, (lon + 180) / STEP
            r, c = int(row), int(column)
            fr, fc = row - r, column - c
            grid = ((tenths[r][c] * (1 - fc) + tenths[r][c + 1] * fc) * (1 - fr)
                    + (tenths[r + 1][c] * (1 - fc) + tenths[r + 1][c + 1] * fc) * fr) / 10
            if -55 <= lat <= 60:  # Where people live; it's worst near the south magnetic pole
                worst = max(worst, abs(grid - declination(model, lat, lon, 0, EPOCH)))
    print(f"Grid: largest interpolation error {worst:.2f} degrees between 55S and 60N")

    data = {"model": model[1], "epoch": EPOCH, "south": SOUTH, "west": -180, "step": STEP, "tenths": tenths}
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
