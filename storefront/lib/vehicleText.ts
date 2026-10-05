import type { PublicVehicle } from "@shared/publicApi";

type Named = Pick<PublicVehicle, "make" | "model" | "class_slug" | "class_name" | "class_description">;

/** A class's words in the visitor's language, falling back to English (always present). */
function words(text: Record<string, string> | null, language: string): string {
  return text?.[language] || text?.en || "";
}

/** What the offer is called: the class name, or make and model for a car without a class. */
export function vehicleName(vehicle: Named, language: string): string {
  return (vehicle.class_slug && words(vehicle.class_name, language)) || `${vehicle.make} ${vehicle.model}`;
}

/** The class description, empty when there is none. */
export function vehicleDescription(vehicle: Named, language: string): string {
  return vehicle.class_slug ? words(vehicle.class_description, language) : "";
}

/** "Fiat Panda" when the name above is a class and this is its example; empty otherwise. */
export function exampleCar(vehicle: Named, language: string): string {
  return vehicle.class_slug && words(vehicle.class_name, language) ? `${vehicle.make} ${vehicle.model}` : "";
}
