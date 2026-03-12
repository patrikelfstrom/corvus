import z from 'zod';

export const themeSchema = z.object({
  light: z.array(z.string()),
  dark: z.array(z.string()),
});

export type Theme = z.infer<typeof themeSchema>;
export type ThemeMap = Record<string, Theme>;
export type ColorScheme = keyof z.infer<typeof themeSchema>;

export const DEFAULT_THEME_NAME = 'corvus';
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'light';

export const themes: ThemeMap = {
  corvus: {
    light: ['#eff2f5', '#A5D6E4', '#52A3C3', '#006699', '#003960'],
    dark: ['#151b23', '#003960', '#006699', '#52A3C3', '#A5D6E4'],
  },
  github: {
    light: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'],
    dark: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'],
  },
  ylgnbu: {
    light: ['#eff2f5', '#a1dab4', '#41b6c4', '#2c7fb8', '#253494'],
    dark: ['#151b23', '#253494', '#2c7fb8', '#41b6c4', '#a1dab4'],
  },
};

export function mergeThemes(customThemes: ThemeMap = {}): ThemeMap {
  return {
    ...themes,
    ...customThemes,
  };
}

export function getInvalidThemeReason(theme: Theme): string | undefined {
  if (theme.light.length !== 5) {
    return `light must contain exactly 5 colors, ${theme.light.length} passed`;
  }

  if (theme.dark.length !== 5) {
    return `dark must contain exactly 5 colors, ${theme.dark.length} passed`;
  }

  return undefined;
}

export function getThemeNames(
  availableThemes: ThemeMap = themes,
): Array<string> {
  return Object.keys(availableThemes);
}
