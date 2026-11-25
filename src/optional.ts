/**
 * Loads an optional peer dependency. A missing package is reported with what needs it and how to install it
 * instead of a bare module resolution error. Any other failure is passed on unchanged.
 */
export async function importOptional<T>(
  load: () => Promise<T>,
  packages: string[],
  feature: string,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const { code, message } = (error ?? {}) as {
      code?: string;
      message?: string;
    };
    if (
      (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
      packages.some((name) => message?.includes(name))
    )
      throw new Error(
        `[noofpi] ${feature} needs ${packages.join(" and ")}: install ${packages.length > 1 ? "them" : "it"} with your package manager (for example \`bun add ${packages.join(" ")}\`)`,
        { cause: error },
      );
    throw error;
  }
}
