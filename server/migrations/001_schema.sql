CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  full_name text NOT NULL,
  birth_date date NOT NULL,
  address_line text,
  home_lat double precision NOT NULL,
  home_lng double precision NOT NULL,
  home_county_fips text NOT NULL,
  medical_conditions jsonb NOT NULL DEFAULT '[]',
  mobility_needs text[] NOT NULL DEFAULT '{}',
  accessibility_notes text NOT NULL DEFAULT '',
  home_risk smallint NOT NULL CHECK (home_risk BETWEEN 1 AND 3),
  home_risk_confidence numeric NOT NULL,
  home_risk_factors jsonb NOT NULL DEFAULT '[]',
  home_risk_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  user_id uuid REFERENCES users(id),
  token_hash text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX devices_phone_idx ON devices(phone);

CREATE TABLE otp_codes (
  phone text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0
);

CREATE TABLE places (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('hq', 'refuge')),
  label text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL
);

CREATE TABLE vehicles (
  id text PRIMARY KEY,
  label text NOT NULL,
  capacity int NOT NULL CHECK (capacity BETWEEN 2 AND 6),
  lat double precision NOT NULL,
  lng double precision NOT NULL
);

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL REFERENCES vehicles(id),
  status text NOT NULL CHECK (status IN ('proposed', 'active', 'completed', 'superseded', 'cancelled')),
  plan_version int NOT NULL,
  refuge_id text NOT NULL REFERENCES places(id),
  depart_at timestamptz NOT NULL,
  refuge_eta timestamptz NOT NULL,
  geometry jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  deployed_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX routes_one_active_per_vehicle ON routes(vehicle_id) WHERE status = 'active';

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  location_source text NOT NULL CHECK (location_source IN ('device', 'home')),
  county_fips text NOT NULL,
  county_risk smallint NOT NULL CHECK (county_risk BETWEEN 1 AND 3),
  vulnerability smallint NOT NULL CHECK (vulnerability BETWEEN 0 AND 3),
  risk smallint NOT NULL CHECK (risk BETWEEN 1 AND 3),
  requires_review boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'routed', 'picked_up', 'dropped_off', 'dismissed')),
  route_id uuid REFERENCES routes(id),
  refuge_id text REFERENCES places(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  routed_at timestamptz,
  picked_up_at timestamptz,
  dropped_off_at timestamptz,
  UNIQUE (user_id, client_request_id)
);
CREATE UNIQUE INDEX incidents_one_open_per_user ON incidents(user_id)
  WHERE status NOT IN ('dropped_off', 'dismissed');

CREATE TABLE route_stops (
  route_id uuid NOT NULL REFERENCES routes(id),
  seq int NOT NULL,
  incident_id uuid NOT NULL REFERENCES incidents(id),
  pickup_eta timestamptz NOT NULL,
  on_foot boolean NOT NULL DEFAULT false,
  skipped boolean NOT NULL DEFAULT false,
  PRIMARY KEY (route_id, seq)
);
CREATE INDEX route_stops_incident_idx ON route_stops(incident_id);

CREATE TABLE status_updates (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id),
  route_id uuid REFERENCES routes(id),
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'dispatcher', 'mobile')),
  at timestamptz NOT NULL DEFAULT now(),
  note text
);
CREATE INDEX status_updates_incident_idx ON status_updates(incident_id, at);
