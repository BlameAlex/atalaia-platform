-- Demo simulation clock: simMs(t) = sim_ms + (t - real_at) * speed. One row, rebased on speed change.
CREATE TABLE sim_clock (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  real_at timestamptz NOT NULL DEFAULT now(),
  sim_ms bigint NOT NULL DEFAULT 0,
  speed int NOT NULL DEFAULT 1 CHECK (speed BETWEEN 1 AND 5)
);
INSERT INTO sim_clock(id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE routes ADD COLUMN sim_deployed_ms bigint;
