import React from 'react';
import { Redirect } from 'react-router-dom';
import { Button, NonIdealState, Spinner } from '@blueprintjs/core';
import { useCurrentOrganization } from '@/hooks/query';

interface EnsureOrganizationIsReadyProps {
  children: React.ReactNode;
  redirectTo?: string;
}

function EnsureOrganizationIsReady({
  // #ownProps
  children,
  redirectTo = '/setup',
}: EnsureOrganizationIsReadyProps) {
  // 103 DiTech: only a loaded organization that isn't built goes to the setup
  // wizard. While loading, or when the server can't be reached (a restart, a
  // network blip), wait and retry: a failed request used to redirect to
  // /setup, which customers can't complete (companies are built by the
  // control plane) and which has no way back.
  const {
    data: organization,
    isError,
    refetch,
    isFetching,
  } = useCurrentOrganization({
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  if (organization) {
    return organization.isReady ? (
      <>{children}</>
    ) : (
      <Redirect to={{ pathname: redirectTo }} />
    );
  }
  if (isError) {
    return (
      <NonIdealState
        icon="offline"
        title="Can't reach the server"
        description="Your data is safe. Check your connection and try again."
        action={
          <Button intent="primary" loading={isFetching} onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  return <NonIdealState icon={<Spinner size={30} />} />;
}

export default EnsureOrganizationIsReady;
