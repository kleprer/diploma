export const FOCUSABLE =
  'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

// :visible - псевдокласс playwright, отсекает скрытые диалоги
export const DIALOG =
  '[role="dialog"]:visible, [role="alertdialog"]:visible, dialog[open]:visible';