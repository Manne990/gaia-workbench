import type { ImportConflictPolicy, ImportPlan } from '../types';

export const DEFAULT_IMPORT_POLICY: ImportConflictPolicy = 'skip-conflicts';

export type ImportWorkflowState = {
  payload: unknown | null;
  fileName: string | null;
  plan: ImportPlan | null;
  policy: ImportConflictPolicy;
  error: string | null;
  message: string | null;
  isPreviewing: boolean;
  isApplying: boolean;
};

export const initialImportWorkflowState: ImportWorkflowState = {
  payload: null,
  fileName: null,
  plan: null,
  policy: DEFAULT_IMPORT_POLICY,
  error: null,
  message: null,
  isPreviewing: false,
  isApplying: false
};

export type ImportWorkflowAction =
  | { type: 'file-preview-started'; fileName: string }
  | { type: 'file-preview-succeeded'; payload: unknown; plan: ImportPlan; error: string | null; message: string | null }
  | { type: 'file-preview-failed'; error: string }
  | { type: 'policy-selected'; policy: ImportConflictPolicy }
  | { type: 'policy-preview-started'; policy: ImportConflictPolicy }
  | { type: 'policy-preview-succeeded'; plan: ImportPlan; error: string | null; message: string | null }
  | { type: 'policy-preview-failed'; error: string }
  | { type: 'apply-started' }
  | { type: 'apply-plan-received'; plan: ImportPlan }
  | { type: 'apply-invalid'; plan: ImportPlan; error: string }
  | { type: 'apply-succeeded'; plan: ImportPlan; message: string }
  | { type: 'apply-failed'; error: string }
  | { type: 'reset' };

export function importWorkflowReducer(state: ImportWorkflowState, action: ImportWorkflowAction): ImportWorkflowState {
  switch (action.type) {
    case 'file-preview-started':
      return {
        ...state,
        payload: null,
        fileName: action.fileName,
        plan: null,
        policy: DEFAULT_IMPORT_POLICY,
        error: null,
        message: null,
        isPreviewing: true
      };
    case 'file-preview-succeeded':
      return {
        ...state,
        payload: action.payload,
        plan: action.plan,
        error: action.error,
        message: action.message,
        isPreviewing: false
      };
    case 'file-preview-failed':
      return {
        ...state,
        payload: null,
        plan: null,
        error: action.error,
        message: null,
        isPreviewing: false
      };
    case 'policy-selected':
      return {
        ...state,
        policy: action.policy
      };
    case 'policy-preview-started':
      return {
        ...state,
        policy: action.policy,
        error: null,
        message: null,
        isPreviewing: true
      };
    case 'policy-preview-succeeded':
      return {
        ...state,
        plan: action.plan,
        error: action.error,
        message: action.message,
        isPreviewing: false
      };
    case 'policy-preview-failed':
      return {
        ...state,
        error: action.error,
        isPreviewing: false
      };
    case 'apply-started':
      return {
        ...state,
        error: null,
        isApplying: true
      };
    case 'apply-plan-received':
      return {
        ...state,
        plan: action.plan
      };
    case 'apply-invalid':
      return {
        ...state,
        plan: action.plan,
        error: action.error,
        isApplying: false
      };
    case 'apply-succeeded':
      return {
        ...state,
        payload: null,
        plan: action.plan,
        message: action.message,
        isApplying: false
      };
    case 'apply-failed':
      return {
        ...state,
        error: action.error,
        isApplying: false
      };
    case 'reset':
      return initialImportWorkflowState;
    default:
      return state;
  }
}

export function selectImportWorkflowView(state: ImportWorkflowState) {
  return {
    isPanelVisible: Boolean(state.fileName || state.plan || state.error || state.isPreviewing || state.message),
    canApply: Boolean(state.payload && state.plan?.valid && !state.isApplying)
  };
}
