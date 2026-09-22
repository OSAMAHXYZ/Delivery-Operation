/** ESAL allocation plan template — edit E-Sales in Admin only */
(function (global) {
  function sfx(name, val) {
    return { sfx: name, defaultVal: val == null ? 0 : val };
  }

  function product(name, items) {
    return { name, items };
  }

  const SEGMENTS = [
    {
      seg: "PC",
      products: [
        product("CROWN", [sfx("K1"), sfx("D2/K3/AA"), sfx("BB/KB/BA/BB"), sfx("DD/KD/DA/DD")]),
        product("CAMRY", [sfx("AA", 24), sfx("AB"), sfx("AH"), sfx("BB", 23), sfx("BH", 5), sfx("BL"), sfx("BS"), sfx("CC", 3), sfx("CH", 7), sfx("DH", 2), sfx("DV"), sfx("EE")]),
        product("SUPRA & 86", [sfx("2.0 Supra"), sfx("3.0 Supra"), sfx("GR86")]),
        product("YARIS SD", [sfx("AA", 13), sfx("BA"), sfx("BB", 2), sfx("CC", 1)]),
        product("Corolla", [sfx("A2", 6), sfx("A3", 3), sfx("AA", 1), sfx("AB", 1), sfx("AH"), sfx("B2", 1), sfx("BB"), sfx("BH"), sfx("D2"), sfx("FH")]),
        product("INNOVA", [sfx("AA", 1), sfx("CH"), sfx("AH")]),
      ],
    },
    {
      seg: "CV",
      products: [
        product("COASTER", [sfx("H1"), sfx("GD"), sfx("G1")]),
        product("HIACE BUS", [sfx("BA"), sfx("BD"), sfx("BG")]),
        product("HIACE VAN", [sfx("GS"), sfx("VD"), sfx("SA"), sfx("GH"), sfx("VH"), sfx("SR")]),
        product("HILUX DC", [sfx("T0"), sfx("U0"), sfx("W1"), sfx("W0"), sfx("R0"), sfx("I1", 2), sfx("MH"), sfx("K0"), sfx("I0"), sfx("J0"), sfx("L0"), sfx("M0"), sfx("X0"), sfx("01"), sfx("03")]),
        product("Liteace", [sfx("AT"), sfx("MT")]),
        product("Hilux SC", [sfx("G0"), sfx("H0"), sfx("B0"), sfx("C0"), sfx("D0"), sfx("Q0"), sfx("E0"), sfx("F0"), sfx("B1/2/3/4")]),
        product("LC70", [
          sfx("G1"), sfx("G2"), sfx("G3"), sfx("G8"), sfx("H1"), sfx("H2"), sfx("H3"), sfx("H4"), sfx("H6"), sfx("H7"), sfx("H8"), sfx("H9"),
          sfx("P1"), sfx("P3"), sfx("P4"), sfx("P5"), sfx("P6"), sfx("D1"), sfx("D2"), sfx("D3"), sfx("D4"), sfx("D5"), sfx("D6"),
          sfx("S1"), sfx("S2"), sfx("S3"), sfx("S4"),
        ]),
      ],
    },
    {
      seg: "SUV",
      products: [
        product("FORTUNER", [sfx("D4"), sfx("G2 GX2 4X2", 2), sfx("G4 GX2 4X4", 4), sfx("K0"), sfx("KL"), sfx("V1", 1), sfx("V2/VS"), sfx("V3"), sfx("W3")]),
        product("LC300", [
          sfx("G0 DSL"), sfx("D2"), sfx("D3/AA"), sfx("S0 DSL"), sfx("AA", 4), sfx("A2"), sfx("G0"), sfx("G2", 4), sfx("G3", 3), sfx("AB", 24),
          sfx("V1"), sfx("ZZ", 1), sfx("S1"), sfx("Z2"), sfx("A1"),
        ]),
        product("PRADO", [sfx("A1"), sfx("A3"), sfx("AS"), sfx("R0"), sfx("R1 PTRL"), sfx("R1 DSL"), sfx("R2"), sfx("U1 / DSL"), sfx("U1 / PETROL"), sfx("XX"), sfx("L3"), sfx("A0")]),
        product("RAV 4", [sfx("AA", 8), sfx("BB", 7), sfx("A2", 1), sfx("SH", 2), sfx("H2"), sfx("AH", 2), sfx("BH", 3), sfx("CH", 3), sfx("VH", 1)]),
        product("VELOZ", [sfx("BB", 13)]),
        product("RAIZE", [sfx("LJ"), sfx("GQ")]),
        product("HIGHLANDER", [sfx("A2", 2), sfx("B4", 4), sfx("B7", 3), sfx("B5/B6"), sfx("C4", 2)]),
        product("URBAN CRUISER", [sfx("A1", 13), sfx("B5", 13)]),
        product("Corolla CR", [sfx("C5"), sfx("CQ"), sfx("CA")]),
      ],
    },
  ];

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /** Flat row list: leaf rows + total rows */
  function buildAllocationPlanRows() {
    const rows = [];
    SEGMENTS.forEach((segment) => {
      const segKey = slug(segment.seg);
      segment.products.forEach((prod) => {
        const groupKey = `${segKey}-${slug(prod.name)}`;
        prod.items.forEach((item) => {
          const id = `${groupKey}-${slug(item.sfx)}`;
          rows.push({
            id,
            kind: "leaf",
            seg: segment.seg,
            product: prod.name,
            sfx: item.sfx,
            groupKey,
            segKey,
            defaultVal: item.defaultVal || 0,
          });
        });
        rows.push({
          id: `${groupKey}-total`,
          kind: "product-total",
          seg: segment.seg,
          product: `${prod.name} TOTAL`,
          sfx: "",
          groupKey,
          segKey,
        });
      });
      rows.push({
        id: `${segKey}-total`,
        kind: "seg-total",
        seg: segment.seg,
        product: segment.seg === "PC" ? "TOTAL PC" : segment.seg === "CV" ? "TOTAL CV" : "TOTAL SUV",
        sfx: "",
        segKey,
      });
    });
    rows.push({
      id: "grand-total",
      kind: "grand-total",
      seg: "",
      product: "Total",
      sfx: "",
    });
    return rows;
  }

  global.AllocationPlanData = {
    SEGMENTS,
    buildAllocationPlanRows,
  };
})(typeof window !== "undefined" ? window : globalThis);
