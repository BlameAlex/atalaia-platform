// Demo area: downtown (mainland) Cancún, west of Nichupté lagoon and the Hotel Zone.
export const BOUNDS = { south: 21.13, west: -86.885, north: 21.185, east: -86.835 };
export const COUNTS = { hq: 1, hospital: 3, sos: 20 };

export const OSRM_URL = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
export const PLAN_DEFAULTS = {
  maxSnapMeters: 250, // farther than this from a drivable road = unreachable
  serviceTimeSec: 120, // time spent at each pickup
  maxPickupDelaySec: 600, // vs. the same vehicle driving straight to the call
  maxHospitalDelaySec: 900, // vs. the same vehicle driving start -> call -> nearest hospital
  maxTripsPerVehicle: 3, // trips planned ahead per vehicle (1-3)
  clusterRadiusSec: 300, // calls within this drive of the seed call form its cluster
  dispatchSlackSec: 120, // vehicles arriving this close to the fastest compete on capacity fit
  dropoffTimeSec: 180, // unloading at the hospital before the next trip
  maxRiskLoad: 7, // stop adding driven pickups once passengers' risk levels sum to this
  walkRadiusMeters: 200, // calls this close to a stop are collected on foot by the team
};
