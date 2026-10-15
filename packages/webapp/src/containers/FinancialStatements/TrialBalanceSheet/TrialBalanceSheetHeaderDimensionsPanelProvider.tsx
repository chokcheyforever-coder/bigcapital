import React, { ReactNode } from 'react';
import { FinancialHeaderLoadingSkeleton } from '../FinancialHeaderLoadingSkeleton';
import { Features } from '@/constants';
import { useBranches } from '@/hooks/query';
import { useFeatureCan } from '@/hooks/state';
import { useProjects } from '@/hooks/query/projects';
import { useProjectsEnabled } from '@/ditech/projects/hooks';

type TrialBLSheetHeaderDimensionsContextValue = {
  branches: ReturnType<typeof useBranches>['data'];
  isBranchesLoading: boolean;
  projects: ReturnType<typeof useProjects>['data'];
  isProjectsEnabled: boolean;
};

interface TrialBLHeaderDimensionsPanelProviderProps {
  query?: Record<string, unknown>;
  children?: ReactNode;
}

const TrialBLSheetHeaderDimensionsContext = React.createContext<
  TrialBLSheetHeaderDimensionsContextValue | undefined
>(undefined);

/**
 *  Trial BL sheet header provider.
 * @returns
 */
function TrialBLHeaderDimensionsPanelProvider({
  query,
  ...props
}: TrialBLHeaderDimensionsPanelProviderProps) {
  // Features guard.
  const { featureCan } = useFeatureCan();
  const isBranchFeatureCan = featureCan(Features.Branches);

  // Fetches the branches list.
  const { isLoading: isBranchesLoading, data: branches } = useBranches(query, {
    enabled: isBranchFeatureCan,
    placeholderData: (prev) => prev,
  });

  // Projects (103 DiTech plan feature).
  const isProjectsEnabled = useProjectsEnabled();
  const { isLoading: isProjectsLoading, data: projects } = useProjects(
    { status: 'all' },
    { enabled: isProjectsEnabled },
  );

  // Provider
  const provider: TrialBLSheetHeaderDimensionsContextValue = {
    branches,
    isBranchesLoading,
    projects,
    isProjectsEnabled,
  };

  return isBranchesLoading || (isProjectsEnabled && isProjectsLoading) ? (
    <FinancialHeaderLoadingSkeleton />
  ) : (
    <TrialBLSheetHeaderDimensionsContext.Provider value={provider} {...props} />
  );
}

const useTrialBalanceSheetPanelContext =
  (): TrialBLSheetHeaderDimensionsContextValue => {
    const ctx = React.useContext(TrialBLSheetHeaderDimensionsContext);
    if (!ctx)
      throw new Error(
        'useTrialBalanceSheetPanelContext must be used within a TrialBLHeaderDimensionsPanelProvider',
      );
    return ctx;
  };

export {
  TrialBLHeaderDimensionsPanelProvider,
  useTrialBalanceSheetPanelContext,
};
