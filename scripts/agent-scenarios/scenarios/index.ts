import { bookingScenarios } from "./booking";
import { reservationLinkScenarios } from "./reservations-link";
import { reservationScenarios } from "./reservations";

export const SCENARIOS = [...bookingScenarios, ...reservationScenarios, ...reservationLinkScenarios];
