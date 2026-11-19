-- Real Houston landmarks: 3 fire stations as rescue bases, 4 historical flood shelters.
-- Ids kept from 002 so existing routes/incidents FKs stay valid.
INSERT INTO places(id, type, label, lat, lng) VALUES
  ('hq',       'hq',     'Houston Fire Station 11',            29.779380, -95.417660), -- 460 T.C. Jester Blvd, Houston, TX 77008
  ('hq-42',    'hq',     'Houston Fire Station 42',            29.744250, -95.272750), -- 8675 Clinton Dr, Houston, TX 77029
  ('hq-90',    'hq',     'Houston Fire Station 90',            29.788940, -95.669490), -- 16553 Park Row, Houston, TX 77084
  ('refuge-1', 'refuge', 'George R. Brown Convention Center',  29.752120, -95.357850), -- 1001 Avenida de las Americas, Houston, TX 77010
  ('refuge-2', 'refuge', 'Greenhouse International Church',    29.949089, -95.423302), -- 200 W Greens Rd, Houston, TX 77067
  ('refuge-3', 'refuge', 'Memorial Drive Presbyterian Church', 29.751300, -95.523200), -- 11612 Memorial Dr, Houston, TX 77024
  ('refuge-4', 'refuge', 'M.O. Campbell Education Center',     29.932220, -95.359720)  -- 1865 Aldine Bender Rd, Houston, TX 77032
ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, label = EXCLUDED.label, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

-- 3 vehicles per base, capacities 2/4/6.
INSERT INTO vehicles(id, label, capacity, lat, lng)
SELECT v.id, v.label, v.capacity, p.lat, p.lng
FROM (VALUES
  ('veh-1', 'Vehículo 1', 2, 'hq'),    ('veh-2', 'Vehículo 2', 4, 'hq'),    ('veh-3', 'Vehículo 3', 6, 'hq'),
  ('veh-4', 'Vehículo 4', 2, 'hq-42'), ('veh-5', 'Vehículo 5', 4, 'hq-42'), ('veh-6', 'Vehículo 6', 6, 'hq-42'),
  ('veh-7', 'Vehículo 7', 2, 'hq-90'), ('veh-8', 'Vehículo 8', 4, 'hq-90'), ('veh-9', 'Vehículo 9', 6, 'hq-90')
) AS v(id, label, capacity, base) JOIN places p ON p.id = v.base
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, capacity = EXCLUDED.capacity, lat = EXCLUDED.lat, lng = EXCLUDED.lng;
