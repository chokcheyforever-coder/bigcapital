export enum ProjectAction {
  View = 'View',
  Create = 'Create',
  Edit = 'Edit',
  Delete = 'Delete',
}

export enum ProjectStatus {
  Active = 'active',
  Closed = 'closed',
}

export const ERRORS = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_CLOSED: 'PROJECT_CLOSED',
  PROJECT_CODE_EXISTS: 'PROJECT_CODE_EXISTS',
  PROJECT_HAS_TRANSACTIONS: 'PROJECT_HAS_TRANSACTIONS',
  CUSTOMER_NOT_FOUND: 'PROJECT_CUSTOMER_NOT_FOUND',
};
