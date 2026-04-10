import { useEffect, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useForm } from 'form-lib/react';
import { useRegister } from 'form-lib/react';
import { useMeta } from 'form-lib/react';
import { FormDevtools } from 'form-lib/devtools';
import { appForm } from './form-definition';
import './app.css';

function App() {
  const { store, Provider, handleSubmit } = useForm(appForm);

  useEffect(() => {
    const devtools = new FormDevtools(store, 'demo-form');
    devtools.connect();
    return () => { devtools.disconnect(); };
  }, [store]);

  return (
    <Provider>
      <FormInner store={store} handleSubmit={handleSubmit} />
    </Provider>
  );
}

function FormInner({ store, handleSubmit }: { store: ReturnType<typeof useForm>['store']; handleSubmit: ReturnType<typeof useForm>['handleSubmit'] }) {
  const { setValue: setSubmitCount, value: submitCount } = useMeta(appForm.submitCount);

  const onSubmit = handleSubmit((values: Record<string, unknown>) => {
    setSubmitCount((submitCount ?? 0) + 1);
    console.log('Form submitted:', values);
  });

  return (
    <div className="container">
      <header className="header">
        <h1>Form Library Demo</h1>
        <p className="subtitle">All spec types: field · object · array · meta</p>
      </header>

      <form onSubmit={onSubmit} noValidate>
        <PersonalInfoSection />
        <AddressSection />
        <TagsSection />
        <ItemsSection />
        <MetaSection count={submitCount ?? 0} />

        <div className="actions">
          <button type="submit" className="btn btn-primary">Submit</button>
          <button type="button" className="btn btn-secondary" onClick={() => store.reset()}>Reset All</button>
        </div>
      </form>
    </div>
  );
}

function FieldInput({ label, spec, type = 'text', placeholder }: {
  label: string;
  spec: Parameters<typeof useRegister>[0];
  type?: string;
  placeholder?: string;
}) {
  const { value, onChange, error, isTouched, setRef } = useRegister(spec as never);
  const className = `input${error ? ' input-error' : ''}${isTouched && !error ? ' input-touched' : ''}`;

  return (
    <div className="field">
      <label className="label">{label}</label>
      <input
        ref={setRef}
        type={type}
        className={className}
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
      />
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function PersonalInfoSection() {
  return (
    <section className="section">
      <h2 className="section-title">Personal Info</h2>
      <div className="grid-2">
        <FieldInput label="First Name" spec={appForm.firstName} placeholder="John" />
        <FieldInput label="Last Name" spec={appForm.lastName} placeholder="Doe" />
      </div>
      <FieldInput label="Email" spec={appForm.email} placeholder="john@example.com" />
      <FieldInput label="Age" spec={appForm.age} placeholder="30" />
      <CheckboxField label="I agree to the terms and conditions" spec={appForm.agreeToTerms} />
    </section>
  );
}

function CheckboxField({ label, spec }: { label: string; spec: Parameters<typeof useRegister>[0] }) {
  const { value, onChange, error, isTouched, setRef } = useRegister(spec as never);
  return (
    <div className="field field-row">
      <input
        ref={setRef}
        type="checkbox"
        className="checkbox"
        checked={!!value}
        onChange={onChange}
      />
      <span>{label}</span>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function AddressSection() {
  return (
    <section className="section">
      <h2 className="section-title">Address <span className="badge">ObjectSpec</span></h2>
      <FieldInput label="Street" spec={appForm.address.street} placeholder="123 Main St" />
      <div className="grid-2">
        <FieldInput label="City" spec={appForm.address.city} placeholder="New York" />
        <FieldInput label="ZIP Code" spec={appForm.address.zip} placeholder="10001" />
      </div>
      <FieldInput label="Country" spec={appForm.address.country} placeholder="US" />
    </section>
  );
}

function TagsSection() {
  const { value, onChange, error, isTouched } = useRegister(appForm.tags as never);
  const tags: string[] = Array.isArray(value) ? value : [];
  const [inputValue, setInputValue] = useState('');

  const addTag = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInputValue('');
    }
  }, [inputValue, tags, onChange]);

  const removeTag = useCallback((tag: string) => {
    onChange(tags.filter(t => t !== tag));
  }, [tags, onChange]);

  const className = `input${error ? ' input-error' : ''}${isTouched && !error ? ' input-touched' : ''}`;

  return (
    <section className="section">
      <h2 className="section-title">Tags <span className="badge">FieldSpec (string[])</span></h2>
      <div className="field">
        <label className="label">Add Tag</label>
        <div className="tag-input-row">
          <input
            className={className}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="Type a tag and press Enter"
          />
          <button type="button" className="btn btn-small" onClick={addTag}>Add</button>
        </div>
        {error && <span className="error">{error}</span>}
      </div>
      {tags.length > 0 && (
        <div className="tags">
          {tags.map(tag => (
            <span key={tag} className="tag">
              {tag}
              <button type="button" className="tag-remove" onClick={() => removeTag(tag)}>×</button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemsSection() {
  const { value, onChange } = useRegister(appForm.items as never);
  const items: Array<{ name: string; quantity: number | string }> = Array.isArray(value) ? value : [];

  const addItem = useCallback(() => {
    onChange([...items, { name: '', quantity: '' }]);
  }, [items, onChange]);

  const updateItem = useCallback((index: number, field: 'name' | 'quantity', val: string) => {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [field]: val };
    });
    onChange(updated);
  }, [items, onChange]);

  const removeItem = useCallback((index: number) => {
    onChange(items.filter((_, i) => i !== index));
  }, [items, onChange]);

  return (
    <section className="section">
      <h2 className="section-title">Items <span className="badge">ArraySpec</span></h2>
      {items.length === 0 && <p className="empty">No items yet. Click "Add Item" to start.</p>}
      {items.map((item, index) => (
        <div key={index} className="item-row">
          <span className="item-number">{index + 1}</span>
          <input
            className="input"
            value={item.name}
            onChange={(e) => updateItem(index, 'name', e.target.value)}
            placeholder="Item name"
          />
          <input
            className="input input-small"
            value={item.quantity}
            onChange={(e) => updateItem(index, 'quantity', e.target.value)}
            placeholder="Qty"
            type="number"
          />
          <button type="button" className="btn btn-remove" onClick={() => removeItem(index)}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={addItem}>+ Add Item</button>
    </section>
  );
}

function MetaSection({ count }: { count: number }) {
  return (
    <section className="section meta-section">
      <h2 className="section-title">Meta <span className="badge">MetaSpec</span></h2>
      <p className="meta-value">Submit count: <strong>{count}</strong></p>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
