import { z } from 'zod/v4';
import { form, field, object, array, meta } from 'form-lib/specs';

export const appForm = form({
  firstName: field<string>({
    id: 'firstName',
    mountRequired: false,
    defaultValue: '',
    schema: z.string().min(1, 'First name is required'),
  }),

  lastName: field<string>({
    id: 'lastName',
    mountRequired: false,
    defaultValue: '',
    schema: z.string().min(1, 'Last name is required'),
  }),

  email: field<string>({
    id: 'email',
    mountRequired: false,
    defaultValue: '',
    schema: z.string().email('Invalid email'),
  }),

  age: field<number, string>({
    id: 'age',
    mountRequired: false,
    defaultValue: '',
    schema: z.coerce.number().min(0, 'Age must be positive').max(150, 'Too old'),
  }),

  agreeToTerms: field<boolean>({
    id: 'agreeToTerms',
    mountRequired: true,
    defaultValue: false,
    schema: z.literal(true, { message: 'You must agree to terms' }),
  }),

  address: object({
    street: field<string>({
      id: 'street',
      mountRequired: false,
      defaultValue: '',
    }),
    city: field<string>({
      id: 'city',
      mountRequired: false,
      defaultValue: '',
      schema: z.string().min(1, 'City is required'),
    }),
    zip: field<string>({
      id: 'zip',
      mountRequired: false,
      defaultValue: '',
      schema: z.string().regex(/^\d{5}$/, 'Must be 5 digits'),
    }),
    country: field<string>({
      id: 'country',
      mountRequired: false,
      defaultValue: 'US',
    }),
  }, { id: 'address', mountRequired: false }),

  tags: field<string[]>({
    id: 'tags',
    mountRequired: false,
    defaultValue: [],
  }),

  items: array(object({
    name: field<string>({ id: 'itemName', mountRequired: false, defaultValue: '' }),
    quantity: field<number, string>({ id: 'itemQty', mountRequired: false, defaultValue: '' }),
  }, { id: 'item', mountRequired: false }), { id: 'items', mountRequired: false }),

  submitCount: meta<number>({ id: 'submitCount' }),
});
