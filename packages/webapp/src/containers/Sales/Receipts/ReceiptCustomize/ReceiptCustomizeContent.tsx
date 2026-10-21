import { initialValues } from './constants';
import { ReceiptCustomizeFieldsContent } from './ReceiptCustomizeFieldsContent';
import { ReceiptCustomizeGeneralField } from './ReceiptCustomizeFieldsGeneral';
import { EstimateBrandingState, ReceiptCustomizeValues } from './types';
import { Box } from '@/components';
import { useDrawerContext } from '@/components/Drawer/DrawerProvider';
import { BrandingTemplateForm } from '@/containers/BrandingTemplates/BrandingTemplateForm';
import { useIsTemplateNamedFilled } from '@/containers/BrandingTemplates/utils';
import {
  ElementCustomize,
  ElementCustomizeContent,
} from '@/containers/ElementCustomize/ElementCustomize';
import { useDrawerActions } from '@/hooks/state';
import { DocumentLayoutFields } from '@/ditech/designer/DocumentLayoutFields';
import { DocumentServerPreview } from '@/ditech/designer/DocumentServerPreview';

export function ReceiptCustomizeContent() {
  const { payload, name } = useDrawerContext();
  const { closeDrawer } = useDrawerActions();
  const templateId = payload?.templateId || null;

  const handleFormSuccess = () => {
    closeDrawer(name);
  };

  return (
    <BrandingTemplateForm<ReceiptCustomizeValues, EstimateBrandingState>
      resource={'SaleReceipt'}
      templateId={templateId}
      defaultValues={initialValues}
      onSuccess={handleFormSuccess}
    >
      <ReceiptCustomizeFormContent />
    </BrandingTemplateForm>
  );
}

function ReceiptCustomizeFormContent() {
  const isTemplateNameFilled = useIsTemplateNamedFilled();

  return (
    <ElementCustomizeContent>
      <ElementCustomize.PaperTemplate>
        {/* 103 DiTech: rendered by the server, exactly as printed. */}
        <Box overflow="auto" flex="1 1">
          <DocumentServerPreview resource={'receipt'} />
        </Box>
      </ElementCustomize.PaperTemplate>

      <ElementCustomize.FieldsTab id={'general'} label={'General'}>
        <ReceiptCustomizeGeneralField />
      </ElementCustomize.FieldsTab>

      <ElementCustomize.FieldsTab
        id={'content'}
        label={'Content'}
        tabProps={{ disabled: !isTemplateNameFilled }}
      >
        <ReceiptCustomizeFieldsContent />
      </ElementCustomize.FieldsTab>

      <ElementCustomize.FieldsTab
        id={'layout'}
        label={'Layout'}
        tabProps={{ disabled: !isTemplateNameFilled }}
      >
        <DocumentLayoutFields />
      </ElementCustomize.FieldsTab>
    </ElementCustomizeContent>
  );
}
