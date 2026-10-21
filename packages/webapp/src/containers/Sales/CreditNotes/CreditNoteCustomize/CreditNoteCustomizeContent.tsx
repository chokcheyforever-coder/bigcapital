import {
  ElementCustomize,
  ElementCustomizeContent,
} from '../../../ElementCustomize/ElementCustomize';
import { initialValues } from './constants';
import { CreditNoteCustomizeGeneralField } from './CreditNoteCustomizeGeneralFields';
import { CreditNoteCustomizeContentFields } from './CreditNoteCutomizeContentFields';
import { CreditNoteBrandingState, CreditNoteCustomizeValues } from './types';
import { Box } from '@/components';
import { useDrawerContext } from '@/components/Drawer/DrawerProvider';
import { BrandingTemplateForm } from '@/containers/BrandingTemplates/BrandingTemplateForm';
import { useIsTemplateNamedFilled } from '@/containers/BrandingTemplates/utils';
import { useDrawerActions } from '@/hooks/state';
import { DocumentLayoutFields } from '@/ditech/designer/DocumentLayoutFields';
import { DocumentServerPreview } from '@/ditech/designer/DocumentServerPreview';

export function CreditNoteCustomizeContent() {
  const { payload, name } = useDrawerContext();
  const { closeDrawer } = useDrawerActions();

  const templateId = payload?.templateId || null;

  const handleSuccess = () => {
    closeDrawer(name);
  };

  return (
    <BrandingTemplateForm<CreditNoteCustomizeValues, CreditNoteBrandingState>
      resource={'CreditNote'}
      templateId={templateId}
      defaultValues={initialValues}
      onSuccess={handleSuccess}
    >
      <CreditNoteCustomizeFormContent />
    </BrandingTemplateForm>
  );
}

function CreditNoteCustomizeFormContent() {
  const isTemplateNameFilled = useIsTemplateNamedFilled();

  return (
    <ElementCustomizeContent>
      <ElementCustomize.PaperTemplate>
        {/* 103 DiTech: rendered by the server, exactly as printed. */}
        <Box overflow="auto" flex="1 1">
          <DocumentServerPreview resource={'credit-note'} />
        </Box>
      </ElementCustomize.PaperTemplate>

      <ElementCustomize.FieldsTab id={'general'} label={'General'}>
        <CreditNoteCustomizeGeneralField />
      </ElementCustomize.FieldsTab>

      <ElementCustomize.FieldsTab
        id={'content'}
        label={'Content'}
        tabProps={{ disabled: !isTemplateNameFilled }}
      >
        <CreditNoteCustomizeContentFields />
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
