import { Todo } from '@/components/TodoList';

export const placeholderTodos: Todo[] = [
  {
    id: '1',
    text: 'Complete project documentation',
    completed: false,
    createdAt: new Date('2025-10-20T10:00:00'),
  },
  {
    id: '2',
    text: 'Review pull requests',
    completed: false,
    createdAt: new Date('2025-10-20T11:30:00'),
  },
  {
    id: '3',
    text: 'Update dependencies',
    completed: true,
    createdAt: new Date('2025-10-19T14:00:00'),
  },
  {
    id: '4',
    text: 'Write unit tests for new features',
    completed: false,
    createdAt: new Date('2025-10-20T15:45:00'),
  },
  {
    id: '5',
    text: 'Fix responsive design issues',
    completed: true,
    createdAt: new Date('2025-10-18T09:00:00'),
  },
  {
    id: '6',
    text: 'Schedule team meeting',
    completed: false,
    createdAt: new Date('2025-10-21T08:00:00'),
  },
  {
    id: '7',
    text: 'Optimize database queries',
    completed: true,
    createdAt: new Date('2025-10-17T16:30:00'),
  },
  {
    id: '8',
    text: 'Update README with setup instructions',
    completed: false,
    createdAt: new Date('2025-10-21T09:15:00'),
  },
];
