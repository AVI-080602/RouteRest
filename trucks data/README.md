# Truck spec sheets

Manufacturer spec sheets and brochures used to research the `vehicle_model`
database table. Kept here for traceability, anyone can check a number in
the database against the actual source document. Retrieved 31 August 2026.

A few filenames end in `-unconfirmed` or `-likely`, meaning the file was
recovered from the research session's cache rather than saved with a name
at download time, and its manufacturer/model was identified afterward from
the PDF's own content. High confidence overall, but worth a quick look if
a number ever looks wrong.

| File | Vehicle | Source URL |
|---|---|---|
| `volvo-fh-64t3a-primemover-spec.pdf` | Volvo FH, prime mover (B-double) | stpi.it.volvo.com, "FH 64T 3A", ref FH 64T 3A 16 AUS |
| `volvo-fh-overview-brochure.pdf` | Volvo FH, general brochure | Volvo Australia |
| `volvo-fm-64r1a-rigid-spec.pdf` | Volvo FM, rigid | stpi.it.volvo.com, "FM 64R 1A", ref FM 64R 1A 16 AUS |
| `volvo-fm-overview-brochure.pdf` | Volvo FM, general brochure | Volvo Australia |
| `kenworth-t610-spec-unconfirmed.pdf` | Kenworth T610, semi-trailer | kenworth.com.au (text did not extract cleanly from this PDF; height and fuel capacity are customer order-sheet options, not fixed here) |
| `kenworth-k200-dimensions-unconfirmed.pdf` | Kenworth K200, B-double | kenworth.com.au brochure; gives frame heights, not a confirmed overall vehicle height |
| `scania-r520-r620-chassis-spec-jan2019.pdf` | Scania R-series (R520/R620), semi-trailer | scania.com, official AU chassis spec, dated Jan 2019, the primary source used |
| `scania-r620-chassis-spec-v1.pdf` | Scania R620, semi-trailer | scania.com, an earlier/alternate version of the same chassis spec |
| `scania-long-haulage-brochure.pdf` | Scania, general brochure | Scania Australia |
| `mack-anthem-bdouble-spec.pdf` | Mack Anthem, B-double | macktrucks.com.au, "Mack Anthem 36 Sleeper B-Double Optimised Spec", ref SS-OPSPEC-ANA36SLEBDBL-0622 |
| `isuzu-giga-au-brochure-2014.pdf` | Isuzu Giga, rigid (Australian market) | Isuzu Australia, "GIGA Series" brochure, effective March 2014. Gives GVM/GCM range only, no height. |
| `isuzu-cyh400-nz-spec-NOT-AU-giga.pdf` | Isuzu CYH400 (New Zealand, NOT the AU Giga above) | isuzu.co.nz, June 2019. A related but different chassis, used only for a height figure, flagged in the database notes as unconfirmed for the actual AU Giga. |
| `hino-700-fy3248-spec-likely.pdf` | Hino 700 Series, FY3248, rigid | hino.co.nz / hino.com.au (AU-hosted copy returned an access error on direct fetch; this NZ-hosted copy of the same AU-sold model was used instead) |
| `fuso-shogun-fv74-spec.pdf` | Fuso Shogun, FV74, semi-trailer | fuso.com.au, official AU spec sheet |

See `backend/db/seed_vehicle_models.sql` for how these numbers were transcribed into the database, including which fields were left NULL because no source confirmed them.
