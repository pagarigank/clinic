import { SetMetadata } from "@nestjs/common";

export const PHI_ACCESS_KEY = "phi_access_key";

export interface PhiAccessOptions {
  /** The route parameter that holds the patient ID (defaults to 'patientId') */
  patientIdParam?: string;
  /** The resource name being accessed */
  resource: string;
}

/**
 * Decorator to mark a route as accessing Patient Health Information (PHI).
 * This will trigger the PhiAccessInterceptor to log the read event.
 */
export const PhiAccess = (options: PhiAccessOptions) =>
  SetMetadata(PHI_ACCESS_KEY, options);
