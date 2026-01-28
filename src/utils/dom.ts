const resolveElementById = <T extends HTMLElement>(id: string, kind: string): T => {
  const el = document.getElementById(id);

  if (!el) {
    throw new Error(`${kind} not found: ${id}`);
  }

  return el as T;
};

export const resolveElement = <T extends HTMLElement>(elOrId: T | string, kind: string): T => {
  if (typeof elOrId === 'string') return resolveElementById<T>(elOrId, kind);

  return elOrId;
};
