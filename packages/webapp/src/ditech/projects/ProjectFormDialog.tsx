// @ts-nocheck
import { Button, Classes, Dialog, Intent, Position } from '@blueprintjs/core';
import { Form, Formik } from 'formik';
import moment from 'moment';
import * as Yup from 'yup';
import { AppToaster, CustomersSelect, FFormGroup, FInputGroup, FDateInput, FTextArea, Group, Stack } from '@/components';
import { FSelect } from '@/components/Forms';
import { useDateInputFormatter } from '@/hooks';
import { useCustomers } from '@/hooks/query';
import { useCreateProject, useEditProject } from '@/hooks/query/projects';

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed (no new transactions)' },
];

const ERROR_MESSAGES = {
  PROJECT_CODE_EXISTS: { code: 'Another project already uses this code.' },
  PROJECT_CUSTOMER_NOT_FOUND: { contactId: 'The customer was not found.' },
};

const Schema = Yup.object().shape({
  name: Yup.string().trim().max(255).required().label('Name'),
  code: Yup.string().trim().max(40).nullable().label('Code'),
  description: Yup.string().max(5000).nullable(),
  contactId: Yup.number().nullable(),
  startDate: Yup.date().nullable(),
  deadline: Yup.date()
    .nullable()
    .when('startDate', (startDate, schema) =>
      startDate ? schema.min(startDate, 'The end date must be after the start date.') : schema,
    ),
  status: Yup.string().oneOf(['active', 'closed']),
});

const toForm = (project) => ({
  name: project?.name ?? '',
  code: project?.code ?? '',
  description: project?.description ?? '',
  contactId: project?.contactId ?? null,
  startDate: project?.startDate ?? null,
  deadline: project?.deadline ?? null,
  status: project?.status ?? 'active',
});

const toRequest = (values) => ({
  name: values.name.trim(),
  code: values.code?.trim() || undefined,
  description: values.description?.trim() || undefined,
  contactId: values.contactId || undefined,
  startDate: values.startDate ? moment(values.startDate).format('YYYY-MM-DD') : undefined,
  deadline: values.deadline ? moment(values.deadline).format('YYYY-MM-DD') : undefined,
  status: values.status,
});

/**
 * Create or edit a project. `project` is null for a new one.
 */
export function ProjectFormDialog({ isOpen, project, onClose }) {
  const isNew = !project;
  const dateInputFormatter = useDateInputFormatter();
  const { data: customersData } = useCustomers({ page_size: 10000 }, { enabled: isOpen });
  const { mutateAsync: createProject } = useCreateProject();
  const { mutateAsync: editProject } = useEditProject();

  const handleSubmit = (values, { setSubmitting, setErrors }) => {
    const request = toRequest(values);
    const action = isNew ? createProject(request) : editProject([project.id, request]);

    action
      .then(() => {
        AppToaster.show({
          message: isNew ? 'The project has been created.' : 'The project has been saved.',
          intent: Intent.SUCCESS,
        });
        onClose();
      })
      .catch((error) => {
        const errors = error?.data?.errors ?? [];
        const fieldErrors = Object.assign({}, ...errors.map((e) => ERROR_MESSAGES[e.type] ?? {}));
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        else AppToaster.show({ message: 'The project could not be saved.', intent: Intent.DANGER });
        setSubmitting(false);
      });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={isNew ? 'New project' : 'Edit project'}
      style={{ width: 460 }}
      canOutsideClickClose={false}
    >
      <Formik initialValues={toForm(project)} validationSchema={Schema} onSubmit={handleSubmit} enableReinitialize>
        {({ isSubmitting }) => (
          <Form>
            <div className={Classes.DIALOG_BODY}>
              <Stack spacing={10}>
                <FFormGroup name={'name'} label={'Name'} labelInfo={'*'}>
                  <FInputGroup name={'name'} autoFocus />
                </FFormGroup>

                <FFormGroup name={'code'} label={'Code'} helperText={'Optional, unique. Shown next to the name in pickers.'}>
                  <FInputGroup name={'code'} />
                </FFormGroup>

                <FFormGroup name={'contactId'} label={'Customer'}>
                  <CustomersSelect
                    name={'contactId'}
                    items={customersData?.data ?? []}
                    placeholder={'No customer'}
                    allowCreate={false}
                    popoverFill={true}
                  />
                </FFormGroup>

                <Group spacing={10} grow noWrap>
                  <FFormGroup name={'startDate'} label={'Start date'}>
                    <FDateInput
                      name={'startDate'}
                      {...dateInputFormatter}
                      popoverProps={{ position: Position.BOTTOM_LEFT, minimal: true }}
                      fill
                    />
                  </FFormGroup>
                  <FFormGroup name={'deadline'} label={'End date'}>
                    <FDateInput
                      name={'deadline'}
                      {...dateInputFormatter}
                      popoverProps={{ position: Position.BOTTOM_LEFT, minimal: true }}
                      fill
                    />
                  </FFormGroup>
                </Group>

                {!isNew && (
                  <FFormGroup name={'status'} label={'Status'}>
                    <FSelect
                      name={'status'}
                      items={STATUSES}
                      valueAccessor={'value'}
                      textAccessor={'label'}
                      popoverProps={{ minimal: true }}
                    />
                  </FFormGroup>
                )}

                <FFormGroup name={'description'} label={'Description'}>
                  <FTextArea name={'description'} growVertically fill />
                </FFormGroup>
              </Stack>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
              <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Button onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button intent={Intent.PRIMARY} type={'submit'} loading={isSubmitting}>
                  {isNew ? 'Create project' : 'Save'}
                </Button>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </Dialog>
  );
}
