const overridesByProvider = new Map();

export function setProviderOverride(providerId, selectors) {
  overridesByProvider.set(providerId, selectors);
}

export function getProviderOverride(providerId) {
  return overridesByProvider.get(providerId) ?? null;
}

export function clearProviderOverride(providerId) {
  overridesByProvider.delete(providerId);
}
