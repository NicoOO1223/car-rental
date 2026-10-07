"use client";

import { useId, type ReactNode } from "react";

/**
 * Form field primitives.
 *
 * These replace an `inputClass`/`labelClass` pair that was copy-pasted
 * verbatim into seven files, plus two further competing input styles used
 * in page-level filter bars and on the fleet page. Three things the old
 * strings got wrong and these fix:
 *
 * - No label was ever associated with its control. There was not one
 *   `htmlFor` in the codebase, so clicking a label did nothing and screen
 *   readers announced unlabelled inputs. `Field` generates an id and wires
 *   it up, so that cannot be forgotten.
 * - There was no focus style at all on modal inputs, and page filters used
 *   `outline-none focus:border-accent-ink`, which removed the browser outline
 *   and replaced it with a 1px border change that is easy to miss.
 * - There was no error state, so every form rendered its validation
 *   message as a detached paragraph with no link to the offending field.
 */

const CONTROL_BASE =
  "w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-ink " +
  "transition placeholder:text-ink-muted " +
  "focus:outline-none focus-visible:outline-none " +
  "focus:ring-2 focus:ring-accent-ink focus:ring-offset-0 focus:border-accent-ink " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted";

const CONTROL_NEUTRAL = "border-border-strong";
const CONTROL_INVALID = "border-danger focus:ring-danger focus:border-danger";

export function controlClass(invalid = false, className = "") {
  return [
    CONTROL_BASE,
    invalid ? CONTROL_INVALID : CONTROL_NEUTRAL,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

type FieldProps = {
  label: string;
  /** Rendered beneath the label, before the control. */
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /**
   * Receives the generated id and the aria wiring. Spread the whole object
   * onto the control so the label, hint and error all connect to it.
   */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    required: boolean | undefined;
  }) => ReactNode;
};

export function Field({
  label,
  hint,
  error,
  required,
  className = "",
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-ink-muted" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}

      <div className="mt-2">
        {children({
          id,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
          required: required || undefined,
        })}
      </div>

      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ComponentPropsWithRef: React 19 hands `ref` to a function component as a prop, so a
// caller can reach the element (the email editor puts the cursor in it).
type InputProps = React.ComponentPropsWithRef<"input"> & {
  invalid?: boolean;
};

export function Input({ invalid, className = "", ...props }: InputProps) {
  return <input className={controlClass(invalid, className)} {...props} />;
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export function Select({ invalid, className = "", ...props }: SelectProps) {
  return <select className={controlClass(invalid, className)} {...props} />;
}

type TextareaProps = React.ComponentPropsWithRef<"textarea"> & {
  invalid?: boolean;
};

export function Textarea({ invalid, className = "", ...props }: TextareaProps) {
  return <textarea className={controlClass(invalid, className)} {...props} />;
}

/**
 * A labelled field for the common case where the control is a plain input
 * or select and no render prop is needed.
 */
export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...inputProps
}: Omit<FieldProps, "children"> & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {(fieldProps) => (
        <Input invalid={Boolean(error)} {...fieldProps} {...inputProps} />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...selectProps
}: Omit<FieldProps, "children"> &
  React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {(fieldProps) => (
        <Select invalid={Boolean(error)} {...fieldProps} {...selectProps}>
          {children}
        </Select>
      )}
    </Field>
  );
}
