import { ApiHealthCheck } from '../components/api-health-check';

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Foundation Step 1</p>
      <h1>Fernleaf Kitchen Operations</h1>
      <p className="intro">
        The frontend reaches the NestJS API through HTTP. Business modules start
        in the next assignment step.
      </p>
      <ApiHealthCheck />
    </main>
  );
}
