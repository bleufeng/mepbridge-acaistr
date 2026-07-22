// knowledge-base-en-US.js
// Built-in Knowledge Base - English Edition (for international release packages)
// Data sources: IBC, IRC, ASME, ASHRAE, NEC, NFPA, ACI, ASTM standards

module.exports = {
  locale: 'en-US',
  region: 'INT',
  version: '1.0.0',
  updatedAt: '2026-06-28',
  sources: [
    'IBC 2021 (International Building Code)',
    'IRC 2021 (International Residential Code)',
    'ICC A117.1-2017 (Accessible and Usable Buildings and Facilities)',
    'NFPA 101-2021 (Life Safety Code)',
    'NFPA 70-2023 (National Electrical Code / NEC)',
    'ASME A112.18.1-2018 (Plumbing Fixture Standards)',
    'ASHRAE 62.2-2022 (Ventilation for Acceptable Indoor Air Quality)',
    'ASHRAE 90.1-2019 (Energy Standard for Buildings)',
    'ACI 318-2019 (Building Code Requirements for Structural Concrete)',
    'ASTM C90-2016 (Hollow Load-Bearing Concrete Masonry Units)',
    'ASTM E119-2016 (Fire Tests of Building Construction Materials)',
    'ASTM C612-2014 (Mineral Fiber Block and Board Thermal Insulation)',
    'AAMA/WDMA/CSA 101/I.S.2/A440-17 (Window/Door Standards)',
    'ASTM D1785-2015 (PVC Plastic Pipe Standards)',
    'ASME B16.9-2018 (Buttwelding Fittings Standards)'
  ],

  // H8.1 Building Code Knowledge Base (International standards)
  buildingCode: [
    // International Residential Code IRC 2021
    { id: 'BC-001', category: 'residential', rule: 'Minimum ceiling height >= 7ft (2.13m) for habitable spaces (design reference)', source: 'IRC 2021 R305.1', severity: 'warning', field: 'height', minValue: 2.13 },
    { id: 'BC-002', category: 'residential', rule: 'Minimum bedroom area >= 70 sq ft (6.5 m2) (design reference)', source: 'IRC 2021 R304.1', severity: 'warning', field: 'roomArea', minValue: 6.5 },
    { id: 'BC-003', category: 'residential', rule: 'Minimum kitchen area >= 50 sq ft (4.6 m2) (design reference)', source: 'IRC 2021 R304.2', severity: 'warning', field: 'roomArea', minValue: 4.6 },
    { id: 'BC-004', category: 'residential', rule: 'Minimum bathroom area >= 30 sq ft (2.8 m2) (design reference)', source: 'IRC 2021 R306.1', severity: 'warning', field: 'roomArea', minValue: 2.8 },
    { id: 'BC-005', category: 'residential', rule: 'Minimum egress door clear width >= 32in (813mm) (safety mandatory)', source: 'IRC 2021 R311.2.1', severity: 'error', field: 'width', minValue: 0.813 },
    { id: 'BC-006', category: 'residential', rule: 'Interior door minimum width >= 28in (711mm) for bedrooms (design reference)', source: 'IRC 2021 R311.2.2', severity: 'warning', field: 'width', minValue: 0.711 },
    { id: 'BC-007', category: 'residential', rule: 'Natural light glazing area >= 8% of floor area for habitable rooms (design reference)', source: 'IRC 2021 R303.1', severity: 'warning', field: null },
    { id: 'BC-008', category: 'residential', rule: 'Guard height >= 36in (914mm) for porches and balconies (safety mandatory)', source: 'IRC 2021 R312.1.2', severity: 'error', field: 'height', minValue: 0.914 },
    // NFPA 101 Life Safety Code and IBC Fire
    { id: 'BC-101', category: 'fireproof', rule: 'Residential buildings minimum fire resistance rating Type V-B (design reference)', source: 'IBC 2021 Table 601', severity: 'warning', field: null },
    { id: 'BC-102', category: 'fireproof', rule: 'Stairway minimum width >= 36in (914mm) for residential (safety mandatory)', source: 'IBC 2021 1011.2', severity: 'error', field: 'width', minValue: 0.914 },
    { id: 'BC-103', category: 'fireproof', rule: 'Fire wall fire resistance rating >= 2.0h (safety mandatory)', source: 'IBC 2021 705.3', severity: 'error', field: null },
    { id: 'BC-104', category: 'fireproof', rule: 'Egress doors swing in direction of exit travel when occupant load > 50', source: 'IBC 2021 1010.1.2.1', severity: 'warning', field: null },
    { id: 'BC-105', category: 'fireproof', rule: 'Fire door ratings: 3h (Class A) / 1.5h (Class B) / 0.75h (Class C) (safety mandatory)', source: 'NFPA 80-2022', severity: 'error', field: null },
    // ICC A117.1 Accessibility
    { id: 'BC-201', category: 'accessibility', rule: 'Accessible door clear width >= 32in (815mm) (design reference)', source: 'ICC A117.1-2017 404.2.3', severity: 'warning', field: 'width', minValue: 0.815 },
    { id: 'BC-202', category: 'accessibility', rule: 'Accessible ramp slope <= 1:12 (design reference)', source: 'ICC A117.1-2017 405.2', severity: 'warning', field: null },
    { id: 'BC-501', category: 'accessibility', rule: 'Building entrance wheelchair ramp clear width >= 48in (1220mm) (safety mandatory)', source: 'ICC A117.1-2017 405.5', severity: 'error', field: 'width', minValue: 1.22 },
    { id: 'BC-502', category: 'accessibility', rule: 'Accessible bathroom area >= 5ft x 5ft (1.5m x 1.5m) (design reference)', source: 'ICC A117.1-2017 603.2', severity: 'warning', field: 'roomArea', minValue: 2.25 },
    // ACI 318 Structural + ASHRAE 90.1 Energy
    { id: 'BC-301', category: 'general', rule: 'Exterior wall thickness >= 8in (200mm) for cold climate insulation (design reference)', source: 'ASHRAE 90.1-2019 Table 5.5', severity: 'warning', field: 'thickness', minValue: 0.2 },
    { id: 'BC-302', category: 'general', rule: 'Minimum slab thickness >= 4in (100mm) cast-in-place (design reference)', source: 'ACI 318-2019 7.5.1', severity: 'warning', field: 'thickness', minValue: 0.1 },
    { id: 'BC-303', category: 'general', rule: 'Minimum one-way slab thickness >= 3.5in (90mm) (design reference)', source: 'ACI 318-2019 7.3.1', severity: 'warning', field: 'thickness', minValue: 0.09 },
    { id: 'BC-304', category: 'general', rule: 'Concrete cover minimum >= 0.6in (15mm) for interior exposure (design reference)', source: 'ACI 318-2019 20.6.1', severity: 'warning', field: null },
    // ASHRAE 90.1 Energy
    { id: 'BC-401', category: 'energy', rule: 'Cold climate exterior wall U-factor <= 0.064 Btu/(hr ft2 F) (design reference)', source: 'ASHRAE 90.1-2019 Table 5.5', severity: 'warning', field: null },
    { id: 'BC-402', category: 'energy', rule: 'Roof U-factor <= 0.032 Btu/(hr ft2 F) for cold climate (design reference)', source: 'ASHRAE 90.1-2019 Table 5.5', severity: 'warning', field: null },
    { id: 'BC-403', category: 'energy', rule: 'Window U-factor <= 0.32 Btu/(hr ft2 F) for cold climate (design reference)', source: 'ASHRAE 90.1-2019 Table 5.5', severity: 'warning', field: null },
    // Kitchen ventilation and stairs
    { id: 'BC-601', category: 'residential', rule: 'Kitchen natural ventilation opening >= 3 sq ft (0.28 m2) (design reference)', source: 'IRC 2021 R303.4', severity: 'warning', field: null },
    { id: 'BC-602', category: 'residential', rule: 'Stair tread depth >= 10in (254mm), riser height <= 7.75in (197mm) for residential (safety mandatory)', source: 'IRC 2021 R311.7.5', severity: 'error', field: null }
  ],

  // H8.2 MEP Standards Knowledge Base (International)
  mepStandard: [
    // ASME Plumbing Standards
    { id: 'MEP-001', domain: 'Piping', subType: 'Water', rule: 'Minimum water supply pipe diameter 1/2in (DN15) for residential service (safety mandatory)', source: 'ASME A112.18.1-2018', severity: 'error', field: 'diameterMm', minValue: 15, commandAction: 'CreatePipe' },
    { id: 'MEP-002', domain: 'Piping', subType: 'Water', rule: 'Branch water pipe diameter 3/4in (DN20) for bathroom and kitchen (design reference)', source: 'IPC 2021 604.5', severity: 'warning', field: 'diameterMm', recommendedValue: 20, commandAction: 'CreatePipe' },
    { id: 'MEP-003', domain: 'Piping', subType: 'Drainage', rule: 'Minimum fixture drain pipe diameter 2in (DN50) for drainage (safety mandatory)', source: 'IPC 2021 702.1', severity: 'error', field: 'diameterMm', minValue: 50, commandAction: 'CreatePipe' },
    { id: 'MEP-004', domain: 'Piping', subType: 'Drainage', rule: 'Main drainage stack diameter 4in (DN100) for bathroom (design reference)', source: 'IPC 2021 705.1', severity: 'warning', field: 'diameterMm', recommendedValue: 100, commandAction: 'CreatePipe' },
    { id: 'MEP-005', domain: 'Piping', subType: 'Water', rule: 'Water pipe height above floor 1.5-2.5ft (0.45-0.75m) for residential (design reference)', source: 'IPC 2021 604.5', severity: 'warning', field: 'z', minRange: [0.45, 0.75], commandAction: 'CreatePipe' },
    { id: 'MEP-006', domain: 'Piping', subType: 'Drainage', rule: 'Drainage pipe slope >= 1/4in per ft (2 percent) for gravity flow (design reference)', source: 'IPC 2021 704.1', severity: 'warning', field: 'slope', minValue: 0.02, commandAction: 'CreatePipe' },
    // ASHRAE 62.2 Ventilation
    { id: 'MEP-101', domain: 'Ventilation', subType: 'Duct', rule: 'Rectangular duct maximum side <= 80in (2000mm) standard (design reference)', source: 'SMACNA 2005', severity: 'warning', field: 'width', maxValue: 2.0, commandAction: 'CreateDuct' },
    { id: 'MEP-102', domain: 'Ventilation', subType: 'Duct', rule: 'Duct air velocity <= 1500 fpm (7.6 m/s) for residential low-pressure (design reference)', source: 'ASHRAE 62.2-2022 5.3', severity: 'warning', field: null },
    { id: 'MEP-103', domain: 'Ventilation', subType: 'Duct', rule: 'Bathroom exhaust duct minimum size 6in (150mm) (design reference)', source: 'ASHRAE 62.2-2022 Table 6.1', severity: 'warning', field: 'width', minValue: 0.15, commandAction: 'CreateDuct' },
    { id: 'MEP-104', domain: 'Ventilation', subType: 'Duct', rule: 'Kitchen exhaust duct minimum size 8in (200mm) (design reference)', source: 'ASHRAE 62.2-2022 Table 6.1', severity: 'warning', field: 'width', minValue: 0.2, commandAction: 'CreateDuct' },
    // NEC 2020 Electrical
    { id: 'MEP-201', domain: 'CableCarrier', subType: 'Electrical', rule: 'Cable tray width <= 24in (600mm) for residential (design reference)', source: 'NEC 2020 392.10', severity: 'warning', field: 'width', maxValue: 0.6, commandAction: 'CreateCableCarrier' },
    { id: 'MEP-202', domain: 'CableCarrier', subType: 'Electrical', rule: 'Cable tray mounting height >= 7.2ft (2.2m) above floor (design reference)', source: 'NEC 2020 392.5', severity: 'warning', field: 'z', minValue: 2.2, commandAction: 'CreateCableCarrier' },
    { id: 'MEP-203', domain: 'CableCarrier', subType: 'Electrical', rule: 'Cable tray to water pipe clearance >= 12in (0.3m) parallel (safety mandatory)', source: 'NEC 2020 300.5', severity: 'error', field: null },
    // AutoRoutePipe specific
    { id: 'MEP-301', domain: 'Piping', subType: null, rule: 'Pipe to obstacle clearance >= 0.79in (20mm) for installation (safety mandatory)', source: 'ASME B16.9-2018', severity: 'error', field: 'clearanceMm', minValue: 20, commandAction: 'AutoRoutePipe' },
    { id: 'MEP-302', domain: 'Piping', subType: null, rule: 'Recommended pipe to obstacle clearance >= 1.97in (50mm) for maintenance (design reference)', source: 'ASME B16.9-2018', severity: 'warning', field: 'clearanceMm', recommendedValue: 50, commandAction: 'AutoRoutePipe' },
    { id: 'MEP-303', domain: 'Piping', subType: null, rule: 'Auto-routing minimum pipe diameter 1/2in (DN15) (safety mandatory)', source: 'ASME A112.18.1-2018', severity: 'error', field: 'diameterMm', minValue: 15, commandAction: 'AutoRoutePipe' }
  ],

  // H8.3 Material Specification Knowledge Base (International)
  material: [
    // Wall materials
    { id: 'MAT-001', type: 'Wall', material: 'AAC Block (Autoclaved Aerated Concrete)', thickness: '8in (200mm)', fireRating: 'A1', thermalConductivity: 0.16, source: 'ASTM C90-2016' },
    { id: 'MAT-002', type: 'Wall', material: 'Reinforced Concrete Wall', thickness: '8in (200mm)', fireRating: 'A1', thermalConductivity: 1.74, source: 'ACI 318-2019' },
    { id: 'MAT-003', type: 'Wall', material: 'Hollow Concrete Masonry Unit', thickness: '10in (240mm)', fireRating: 'A2', thermalConductivity: 0.45, source: 'ASTM C90-2016' },
    { id: 'MAT-004', type: 'Wall', material: 'Steel Stud Gypsum Board', thickness: '5in (120mm)', fireRating: 'B1', thermalConductivity: 0.25, source: 'ASTM C1396-2017' },
    { id: 'MAT-005', type: 'Wall', material: 'Curtain Wall Glass', thickness: '8in (200mm, insulated Low-E)', fireRating: 'A2', thermalConductivity: 1.8, source: 'ASTM E2112-2019' },
    // Slab materials
    { id: 'MAT-101', type: 'Slab', material: 'Cast-in-Place Reinforced Concrete', thickness: '5in (120mm)', fireRating: 'A1', thermalConductivity: 1.74, source: 'ACI 318-2019' },
    { id: 'MAT-102', type: 'Slab', material: 'Hollow Core Precast Slab', thickness: '6in (150mm)', fireRating: 'A1', thermalConductivity: 1.2, source: 'PCI MNL-116-2019' },
    { id: 'MAT-103', type: 'Slab', material: 'Composite Steel Deck Slab', thickness: '6in (150mm)', fireRating: 'A1', thermalConductivity: 1.74, source: 'ASCE 3-2010' },
    // Roof materials
    { id: 'MAT-201', type: 'Roof', material: 'Cast-in-Place Concrete Roof', thickness: '6in (150mm)', fireRating: 'A1', thermalConductivity: 1.74, source: 'ACI 318-2019' },
    { id: 'MAT-202', type: 'Roof', material: 'Profiled Steel Roof (insulated)', thickness: '3in (80mm, insulated)', fireRating: 'B1', thermalConductivity: 0.04, source: 'ASTM A653' },
    // Door and Window materials
    { id: 'MAT-301', type: 'Door', material: 'Wood Flush Door', thickness: '1.5in (40mm)', fireRating: 'B1', thermalConductivity: 0.16, source: 'ANSI/WDMA I.S.1A-2017' },
    { id: 'MAT-302', type: 'Window', material: 'Aluminum Clad Window', thickness: '2.75in (70mm, insulated glass)', fireRating: 'B1', thermalConductivity: 2.8, source: 'AAMA/WDMA 101-17' },
    { id: 'MAT-303', type: 'Door', material: 'Fire Door (Wood)', thickness: '2in (50mm)', fireRating: 'Class A 1.5h', thermalConductivity: 0.16, source: 'NFPA 80-2022' },
    { id: 'MAT-304', type: 'Door', material: 'Fire Door (Steel)', thickness: '2.2in (55mm)', fireRating: 'Class B 1.0h', thermalConductivity: 0.58, source: 'NFPA 80-2022' },
    // Pipe materials
    { id: 'MAT-401', type: 'Pipe', material: 'PEX Water Pipe', thickness: 'PN1.6MPa', fireRating: 'B2', thermalConductivity: 0.24, source: 'ASTM F876-2018' },
    { id: 'MAT-402', type: 'Pipe', material: 'PVC Drainage Pipe', thickness: 'Schedule 40', fireRating: 'B2', thermalConductivity: 0.16, source: 'ASTM D1785-2015' },
    { id: 'MAT-403', type: 'Pipe', material: 'Galvanized Steel Pipe', thickness: 'PN1.6MPa', fireRating: 'A1', thermalConductivity: 0.45, source: 'ASTM A53-2018' }
  ],

  // LLM injection section templates (English)
  i18n: {
    sectionTitle: '## Domain Knowledge Base (H8 Building Code + MEP Standards + Material Specs)',
    sectionIntro: '**Important**: Commands must comply with the following standards. Violations reduce confidence and trigger warningText.',
    buildingTitle: '### Building Code (International Standards)',
    mepTitle: '### MEP Standards',
    materialTitle: '### Common Material Specifications',
    severityError: 'MUST',
    severityWarning: 'RECOMMEND',
    sourceLabel: 'Source',
    materialHints: [
      'Exterior wall: AAC Block 200mm / Reinforced Concrete 200mm',
      'Interior wall: Steel Stud Gypsum Board 120mm / Hollow CMU 240mm',
      'Slab: Cast-in-Place Reinforced Concrete 120mm',
      'Door: Wood Flush 40mm / Window: Aluminum Clad 70mm'
    ],
    // Task type inference keywords (English)
    intentKeywords: {
      pipe: ['pipe', 'duct', 'cable tray', 'conduit'],
      building: ['wall', 'slab', 'roof', 'column', 'beam'],
      doorWindow: ['door', 'window'],
      drainage: ['drainage', 'drain', 'sewer'],
      water: ['water', 'supply'],
      duct: ['duct', 'ventilation', 'air'],
      electrical: ['cable', 'tray', 'electrical']
    }
  }
};
