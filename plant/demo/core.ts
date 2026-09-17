import { system, simulation, bank, aggregate, derived, signal, add } from "@scada/plant";
export const coreSystem = system("core", "Реактор и группы каналов", "unit4");
export const groupA = system("coreA", "Каналы · группа A", "core");
export const groupB = system("coreB", "Каналы · группа B", "core");
export const reactor = simulation("CORE", "feedback-source", {
    system: "core", at: { x: 690, y: 55 },
    parameters: { initialPower: 0.8, feedback: 3 },
    inputs: { void: signal("core.void"), temperature: signal("core.temperature"), absorber: signal("PROTECT.insertion") },
});
// One declaration per group, stable instance IDs and independent component state.
export const groupAChannels = bank("CH-A", "channel", {
    count: 6, columns: 3, pitch: { x: 265, y: 210 },
    system: "coreA", at: { x: 550, y: 330 },
    inputs: { power: reactor.power, flow: signal("PUMP-A.flow"), inlet: signal("COND.temperature") },
});
export const groupBChannels = bank("CH-B", "channel", {
    count: 6, columns: 3, pitch: { x: 265, y: 210 },
    system: "coreB", at: { x: 550, y: 800 },
    inputs: { power: reactor.power, flow: signal("PUMP-B.flow"), inlet: signal("COND.temperature") },
});
export const channels = [...groupAChannels, ...groupBChannels];
export const aheat = derived("loopA.heat", aggregate(groupAChannels, "heat"));
export const bheat = derived("loopB.heat", aggregate(groupBChannels, "heat"));
export const aresistance = derived("loopA.resistance", aggregate(groupAChannels, "resistance"));
export const bresistance = derived("loopB.resistance", aggregate(groupBChannels, "resistance"));
export const temperature = derived("core.temperature", aggregate(channels, "temperature"));
export const voidFraction = derived("core.void", aggregate(channels, "void"));
export const damage = derived("core.damage", aggregate(channels, "damage", "max"));
export const release = derived("core.release", aggregate(channels, "release", "sum"));
export const balance = derived("core.balance", aggregate(channels, "balance", "sum"));
export const coreSignals = [aheat, bheat, aresistance, bresistance, temperature, voidFraction, damage, release, balance];
