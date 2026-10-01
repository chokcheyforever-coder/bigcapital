// @ts-nocheck
import { Alert, Intent, Menu, MenuItem, MenuDivider } from '@blueprintjs/core';
import intl from 'react-intl-universal';
import React, { useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import PreferencesSidebarContainer from './PreferencesSidebarContainer';
import { FormattedMessage as T } from '@/components';
import { PreferencesMenu } from '@/constants/preferencesMenu';
import { useFeatureCan } from '@/hooks/state/feature';
import { isLocked, portalUrl, usePlanFeatures } from '@/ditech/plan';

import '@/style/pages/Preferences/Sidebar.scss';

/**
 * Preferences sidebar.
 */
export default function PreferencesSidebar() {
  const history = useHistory();
  const location = useLocation();
  const { featureCan } = useFeatureCan();
  const { data: plan } = usePlanFeatures();
  const [lockedItem, setLockedItem] = useState(null);

  const items = PreferencesMenu.filter((item) => {
    if (item.feature && !featureCan(item.feature)) {
      return false;
    }
    return true;
  }).map((item) =>
    item.divider ? (
      <MenuDivider title={item.title} />
    ) : (
      <MenuItem
        active={item.href && item.href === location.pathname}
        text={item.text}
        label={isLocked(plan, item.planFeature) ? '🔒' : item.label}
        disabled={item.disabled}
        onClick={() => {
          if (isLocked(plan, item.planFeature)) setLockedItem(item);
          else history.push(item.href);
        }}
      />
    ),
  );

  return (
    <PreferencesSidebarContainer>
      <div class="preferences-sidebar__head">
        <h2>{<T id={'preferences'} />}</h2>
      </div>

      <Menu className="preferences-sidebar__menu">{items}</Menu>

      <Alert
        isOpen={!!lockedItem}
        icon="lock"
        intent={Intent.PRIMARY}
        cancelButtonText={intl.get('cancel')}
        confirmButtonText={intl.get('ditech.upgrade.button')}
        onCancel={() => setLockedItem(null)}
        onConfirm={() => window.location.assign(portalUrl())}
      >
        <p>{intl.get('ditech.upgrade.feature_locked')}</p>
      </Alert>
    </PreferencesSidebarContainer>
  );
}
