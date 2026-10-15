import { configService } from '@/common/config/configService';
import { useConfig } from '@/renderer/hooks/config/useConfig';
import { useMemo } from 'react';
import { normalizeProjectPins } from './order';

export const PROJECT_PINS_CONFIG_KEY = 'sidebar.pinnedWorkspaces' as const;
let pendingSave = Promise.resolve();

/** Serialize writes so rapid pins of different groups cannot overwrite each other. */
export const setProjectPinned = (workspace: string, pinned: boolean): Promise<void> => {
  const save = pendingSave.then(async () => {
    if (!workspace.trim()) return;
    await configService.whenReady();
    const previous = configService.get(PROJECT_PINS_CONFIG_KEY);
    const order = normalizeProjectPins(previous);
    if (order.includes(workspace) === pinned) return;
    const next = pinned ? [...order, workspace] : order.filter((item) => item !== workspace);
    try {
      await configService.set(PROJECT_PINS_CONFIG_KEY, next);
    } catch (error) {
      if (configService.get(PROJECT_PINS_CONFIG_KEY) === next) {
        configService.setLocal(PROJECT_PINS_CONFIG_KEY, previous);
      }
      throw error;
    }
  });
  pendingSave = save.catch(() => {});
  return save;
};

/** Observe the project pin order stored in the current user's preferences. */
export const useProjectPins = () => {
  const [configuredPins] = useConfig(PROJECT_PINS_CONFIG_KEY);
  const pinnedWorkspaces = useMemo(() => normalizeProjectPins(configuredPins), [configuredPins]);
  return { pinnedWorkspaces, setProjectPinned };
};
