import collector from './collector.js';
import { collectNative } from './native-collector.js';

export default collector.specialize({ collect: (input) => collectNative(input, 'python') });
