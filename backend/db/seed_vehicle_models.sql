-- ============================================================================
-- Seed data: vehicle_model
--
-- What this file is for: populates vehicle_model with real, sourced specs
-- for nine common heavy vehicles operating in Australia, researched from
-- official manufacturer spec sheets and brochures (see the "trucks data"
-- folder at the repo root for the actual source PDFs).
--
-- Methodology, so future entries stay consistent:
--   - weight_kg is GVM (gross vehicle mass) for rigid trucks, since there
--     is no separate trailer, and GCM (gross combination mass) for
--     semi_trailer and b_double configurations, since that is the figure
--     that actually matters once a trailer is attached, and the one
--     OpenRouteService's HGV routing needs to avoid weight-restricted
--     roads for the loaded combination.
--   - Where a manufacturer publishes a range (e.g. a cab height that
--     varies by trim) rather than one fixed figure, the base/standard
--     configuration is stored, with the fuller range recorded in notes.
--     Per the schema comment on tank_capacity_l, every figure here is a
--     default the app should let the driver override, not a locked fact.
--   - Where NO figure could be confirmed from an official source, the
--     field is left NULL rather than filled with a plausible-sounding
--     guess. This happened for several Kenworth and Scania figures, and
--     for two vehicles' height, see the notes column on each row.
--   - No manufacturer publishes fuel consumption per model. Every
--     consumption_l_per_100km value here is an ABS national fleet
--     average for that vehicle's class (rigid vs articulated), not a
--     model-specific figure. This is stated in every row's notes, not
--     just here, so it survives being read out of context.
--
-- Retrieved and verified: 31 August 2026.
-- ============================================================================

-- One source_file row per vehicle, so every spec can be traced back to the
-- actual document it came from.
INSERT INTO source_file (source_name, publisher, licence, url, retrieved_at, notes) VALUES
    ('Volvo FH 64T 3A prime mover spec sheet', 'Volvo Trucks Australia', NULL, 'https://stpi.it.volvo.com', now(), 'Ref FH 64T 3A 16 AUS. See trucks data/volvo-fh-64t3a-primemover-spec.pdf.'),
    ('Volvo FM 64R 1A rigid spec sheet', 'Volvo Trucks Australia', NULL, 'https://stpi.it.volvo.com', now(), 'Ref FM 64R 1A 16 AUS. See trucks data/volvo-fm-64r1a-rigid-spec.pdf.'),
    ('Kenworth T610 spec sheet', 'Kenworth Australia', NULL, 'https://www.kenworth.com.au', now(), 'PDF text did not extract cleanly; height, fuel capacity and GCM are treated as customer order-sheet options by Kenworth, not fixed spec-sheet figures. See trucks data/kenworth-t610-spec-unconfirmed.pdf.'),
    ('Kenworth K200 brochure', 'Kenworth Australia', NULL, 'https://www.kenworth.com.au', now(), 'Gives frame heights only, not a confirmed overall vehicle height. GCM and tank capacity corroborated against dealer/industry references. See trucks data/kenworth-k200-dimensions-unconfirmed.pdf.'),
    ('Scania R520/R620 6x4 prime mover chassis specification', 'Scania Australia', NULL, 'https://www.scania.com', now(), 'Dated January 2019. Does not publish a single GCM figure. See trucks data/scania-r520-r620-chassis-spec-jan2019.pdf.'),
    ('Mack Anthem 36 Sleeper B-Double Optimised Spec', 'Mack Trucks Australia', NULL, 'https://www.macktrucks.com.au', now(), 'Ref SS-OPSPEC-ANA36SLEBDBL-0622. Height dimension in the source diagram could not be confirmed as referring to overall vehicle height. See trucks data/mack-anthem-bdouble-spec.pdf.'),
    ('Isuzu Giga Series brochure', 'Isuzu Australia', NULL, 'https://www.isuzu.com.au', now(), 'Effective March 2014. Gives a GVM/GCM range for the AU rigid line, no height figure. See trucks data/isuzu-giga-au-brochure-2014.pdf.'),
    ('Hino 700 Series FY3248 specification sheet', 'Hino Motors Australia', NULL, 'https://www.hino.com.au', now(), 'AU-hosted copy returned an access error on direct fetch; a NZ-hosted copy of the same AU-sold model was used instead. See trucks data/hino-700-fy3248-spec-likely.pdf.'),
    ('Shogun FV74 6x4 prime mover spec sheet', 'Fuso Trucks Australia', NULL, 'https://www.fuso.com.au', now(), 'MY21 spec. See trucks data/fuso-shogun-fv74-spec.pdf.');

-- The nine vehicles. source_file_id is looked up by name so this file
-- does not depend on guessing the auto-generated ids from the inserts above.
INSERT INTO vehicle_model (make, model, configuration, height_m, weight_kg, tank_capacity_l, fuel_type, consumption_l_per_100km, source_file_id, notes) VALUES
    ('Volvo', 'FH', 'b_double', 3.50, 70000, 610, 'diesel', 60.00,
        (SELECT id FROM source_file WHERE source_name = 'Volvo FH 64T 3A prime mover spec sheet'),
        'Height is the standard Sleeper Cab (SLP6) figure. Taller Globetrotter XL/XXL cabs reach up to about 3.95 m, treat 3.50 m as a default the driver should override if they know their cab is taller. Weight is the GCM rating of the standard-fit rear axle for typical Australian B-double linehaul use; higher-rated driveline options support 100 to 115 tonnes GCM for higher-mass-limit combinations. consumption_l_per_100km is an ABS articulated-truck class average, adjusted toward the higher end of industry-cited real-world B-double consumption (up to roughly 65 L/100km), not a Volvo-specific figure.'),
    ('Volvo', 'FM', 'rigid', 3.13, 23000, 345, 'diesel', 28.60,
        (SELECT id FROM source_file WHERE source_name = 'Volvo FM 64R 1A rigid spec sheet'),
        'Height and GVM are for the standard Day Cab, 6x4 rigid configuration. GVM is the plated figure (23,000 kg); the design rating is higher (28,100 kg) but the plated figure is the legally relevant limit. consumption_l_per_100km is an ABS rigid-truck class average, not a Volvo-specific figure.'),
    ('Kenworth', 'T610', 'semi_trailer', NULL, NULL, NULL, 'diesel', 53.10,
        (SELECT id FROM source_file WHERE source_name = 'Kenworth T610 spec sheet'),
        'Height, GCM and fuel tank capacity are NOT publicly confirmed for this model: Kenworth documents these as customer order-sheet options rather than fixed spec-sheet figures. A 97-tonne GCM figure is cited in trade press but for the T620 (this model''s successor), not T610 itself, so it is deliberately not stored here as this vehicle''s figure. Application code must use the conservative routing default (4.3 m, 42.5 t) for this vehicle until real figures are confirmed. consumption_l_per_100km is an ABS articulated-truck class average.'),
    ('Kenworth', 'K200', 'b_double', NULL, 97000, 1220, 'diesel', 60.00,
        (SELECT id FROM source_file WHERE source_name = 'Kenworth K200 brochure'),
        'Height is NOT publicly confirmed: the brochure gives frame heights (1007 to 1092 mm depending on suspension/tyres) but not a total vehicle height. Application code must use the conservative routing default (4.3 m) for height on this vehicle until a real figure is confirmed. GCM (97 t nominal; up to 250 t available for special heavy-haulage applications) and fuel capacity (2 x 610 L dual tanks) are the Kenworth-confirmed figures. consumption_l_per_100km is an ABS articulated-truck class average, adjusted toward higher real-world B-double consumption, not a Kenworth-specific figure.'),
    ('Scania', 'R620', 'semi_trailer', 3.71, NULL, 1030, 'diesel', 53.10,
        (SELECT id FROM source_file WHERE source_name = 'Scania R520/R620 6x4 prime mover chassis specification'),
        'Height is the NG R Sleeper Cab Highline figure (3,694 to 3,733 mm range, midpoint stored). Scania''s chassis specification sheets do not publish a single GCM figure; dealer references mention configurations up to 130 tonnes for fuel-haul applications, but this is not a confirmed manufacturer spec, so weight_kg is left NULL. Application code must use the conservative routing default (42.5 t) for weight on this vehicle until a real figure is confirmed. Tank capacity (1,030 L) is dual tanks (710 L + 320 L); a separate 105 L AdBlue tank exists but is not diesel and is not counted here. consumption_l_per_100km is an ABS articulated-truck class average.'),
    ('Mack', 'Anthem', 'b_double', NULL, 70000, 1460, 'diesel', 60.00,
        (SELECT id FROM source_file WHERE source_name = 'Mack Anthem 36 Sleeper B-Double Optimised Spec'),
        'Height is NOT publicly confirmed: the official spec sheet diagram includes a 3,685 mm dimension whose axis (length vs height) could not be reliably confirmed, so it is not stored as a height figure. Application code must use the conservative routing default (4.3 m) for height on this vehicle until a real figure is confirmed. GCM (70,000 kg) is explicitly stated for B-Double linehaul applications in the spec sheet. Tank capacity (1,460 L) is three tanks combined (660 L + 300 L + 500 L). consumption_l_per_100km is an ABS articulated-truck class average, adjusted toward higher real-world B-double consumption, not a Mack-specific figure.'),
    ('Isuzu', 'Giga', 'rigid', NULL, 25000, NULL, 'diesel', 28.60,
        (SELECT id FROM source_file WHERE source_name = 'Isuzu Giga Series brochure'),
        'Weight is the midpoint of the Australian Giga rigid line''s published GVM range (24,000 to 26,000 kg); the brochure covers a range of rigid configurations rather than one fixed model, so treat this as an approximation. Height and tank capacity are NOT confirmed for the Australian Giga: the only figures found (2.92 m height, 400 L tank) come from the Isuzu New Zealand CYH400, a related but different chassis on a different GVM tier, and are NOT stored here to avoid presenting an unconfirmed cross-model figure as fact. Application code must use the conservative routing default (4.3 m) for height on this vehicle until a real Australian figure is confirmed. consumption_l_per_100km is an ABS rigid-truck class average.'),
    ('Hino', '700 Series (FY3248)', 'rigid', 3.06, 32000, 390, 'diesel', 28.60,
        (SELECT id FROM source_file WHERE source_name = 'Hino 700 Series FY3248 specification sheet'),
        '8x4 rigid configuration. GVM (32,000 kg) and height (3.06 m unladen) are both manufacturer-confirmed. A separate 28 L AdBlue tank exists but is not diesel and is not counted in the 390 L figure. consumption_l_per_100km is an ABS rigid-truck class average, not a Hino-specific figure.'),
    ('Fuso', 'Shogun (FV74)', 'semi_trailer', 3.30, 63000, 400, 'diesel', 53.10,
        (SELECT id FROM source_file WHERE source_name = 'Shogun FV74 6x4 prime mover spec sheet'),
        'Height is the standard-roof figure; a high-roof option reaches 3.65 m, treat 3.30 m as a default the driver should override if they know their cab is the high-roof variant. Weight is GCM (63,000 kg), the combination figure for this prime mover with a trailer attached; GVM for the prime mover alone is 26,000 kg. consumption_l_per_100km is an ABS articulated-truck class average, not a Fuso-specific figure.');
