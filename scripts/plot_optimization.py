import csv
from pathlib import Path

STRESS_DIR = Path(__file__).resolve().parent.parent / "stress-tests"
OUT_PNG = STRESS_DIR / "optimization_chart.png"
TITLE = "Evolucion de latencia - MiningFOMC API (VPS: 2 vCPU, 1.86 GiB)"

GROUPS = {
    "Busqueda (search, limit=200, 1976-2020)": [
        ("Original (sin optimizacion)", "test1.csv"),
        ("Sin cache (warm)", "warm.csv"),
        ("Sin cache (base1)", "base1.csv"),
        ("Con indice invertido (frio)", "idx-cold.csv"),
        ("Con cache compartida L1+L2+L3 (caliente)", "idx-hot.csv"),
    ],
    "Comparador (compare-tree, 60 docs)": [
        ("Antes (sin cache disco)", "compare-tree-2.csv"),
        ("Con cache disco (frio)", "matrix-cold.csv"),
        ("Con cache disco (caliente)", "matrix-hot.csv"),
        ("Pre-poblado (frio)", "matrix-prepop.csv"),
    ],
    "Concurrencia (3 requests simultaneos)": [
        ("Sin optimizacion", "conc3.csv"),
        ("Con gates (2 workers)", "conc3-2.csv"),
    ],
}


def mean_wall_ms(path):
    with path.open(newline="") as fh:
        rows = [r for r in csv.DictReader(fh) if r["status"] == "200"]
    return sum(float(r["wall_ms"]) for r in rows) / len(rows)


def load():
    return {
        group: [(label, mean_wall_ms(STRESS_DIR / name)) for label, name in items]
        for group, items in GROUPS.items()
    }


def render_ascii(data):
    print(TITLE)
    print()
    for group, items in data.items():
        peak = max(v for _, v in items)
        width = 50
        print(group)
        for label, value in items:
            bar = "#" * round(value / peak * width)
            print(f"  {label:<32} {value:>8.0f} ms |{bar}")
        print()


def render_png(data):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, len(data), figsize=(18, 7))
    colors = ["#4c72b0", "#dd8452", "#55a868"]
    for ax, (group, items), color in zip(axes, data.items(), colors):
        labels = [label for label, _ in items]
        values = [value for _, value in items]
        bars = ax.bar(range(len(items)), values, color=color)
        ax.bar_label(bars, fmt="%.0f", padding=3, fontsize=9)
        ax.set_title(group, fontsize=11)
        ax.set_ylabel("Latencia (ms)")
        ax.set_xticks(range(len(items)))
        ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=9)
        ax.grid(axis="y", linestyle=":", alpha=0.5)
        ax.margins(y=0.12)

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(OUT_PNG, dpi=130)
    print(f"PNG: {OUT_PNG}")


def main():
    data = load()
    try:
        render_png(data)
    except ImportError:
        print("matplotlib no disponible, salida ASCII\n")
        render_ascii(data)


if __name__ == "__main__":
    main()
