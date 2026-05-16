/**
 * Capability negotiation for the handshake.
 *
 * All three Script API modules are statically imported by the bundle, so a
 * running script *is* proof they loaded — there is nothing to probe for module
 * presence. The probe's real jobs are therefore:
 *
 *  1. Assemble the `script_modules` list the handshake reports, with versions
 *     drawn from the build-time manifest mirror (the Script API exposes no
 *     runtime version accessor).
 *  2. Feature-detect optional APIs that vary across BDS builds, so a handler
 *     that needs one can fail fast with `UNSUPPORTED_CAPABILITY` instead of a
 *     cryptic Script API throw.
 */
import type { World } from "@minecraft/server";
import { CommandError } from "../errors/command-error";
import { MODULE_VERSIONS } from "../generated/module-versions";
import type { Logger } from "../runtime/logger";
import type { ScriptModule } from "../protocol";

/** An optional Script API feature whose availability varies across BDS builds. */
export type Capability = "structure.list";

/** The outcome of capability probing, consumed by the handshake and handlers. */
export interface CapabilityReport {
  /** Script API modules and versions, for the handshake's `script_modules`. */
  readonly scriptModules: readonly ScriptModule[];
  /** Whether an optional feature is available. */
  supports(feature: Capability): boolean;
  /** Throws `UNSUPPORTED_CAPABILITY` if an optional feature is unavailable. */
  requireFeature(feature: Capability): void;
}

function detectFeatures(world: World): Set<Capability> {
  const features = new Set<Capability>();
  const structureManager = world.structureManager as unknown as Record<string, unknown>;
  if (typeof structureManager["getWorldStructureIds"] === "function") {
    features.add("structure.list");
  }
  return features;
}

/** Builds the {@link CapabilityReport} for this BDS build. */
export function probeCapabilities(world: World, logger: Logger): CapabilityReport {
  const scriptModules: ScriptModule[] = Object.entries(MODULE_VERSIONS).map(([name, version]) => ({
    name,
    version,
  }));
  const features = detectFeatures(world);
  logger.info("capability probe complete", {
    modules: scriptModules.map((module) => `${module.name}@${module.version}`),
    features: [...features],
  });
  return {
    scriptModules,
    supports: (feature) => features.has(feature),
    requireFeature: (feature) => {
      if (!features.has(feature)) {
        throw CommandError.unsupported(`this BDS build does not support capability '${feature}'`);
      }
    },
  };
}
