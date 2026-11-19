INSERT INTO places(id, type, label, lat, lng) VALUES
  ('hq',       'hq',     'HQ',        29.7858, -95.8245),
  ('refuge-1', 'refuge', 'Refugio 1', 29.7900, -95.8500),
  ('refuge-2', 'refuge', 'Refugio 2', 29.7780, -95.8150),
  ('refuge-3', 'refuge', 'Refugio 3', 29.8050, -95.7700)
ON CONFLICT DO NOTHING;

INSERT INTO vehicles(id, label, capacity, lat, lng) VALUES
  ('veh-1', 'Vehículo 1', 2, 29.7858, -95.8245),
  ('veh-2', 'Vehículo 2', 4, 29.7858, -95.8245),
  ('veh-3', 'Vehículo 3', 4, 29.7858, -95.8245),
  ('veh-4', 'Vehículo 4', 6, 29.7858, -95.8245)
ON CONFLICT DO NOTHING;
