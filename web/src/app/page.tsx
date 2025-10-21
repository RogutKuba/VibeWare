import TodoList from '@/components/TodoList';
import { placeholderTodos } from '@/data/placeholderTodos';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <TodoList initialTodos={placeholderTodos} />
    </div>
  );
}
