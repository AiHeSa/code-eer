<script lang="ts">
export default { props: ['title'], emits: ['save'] };
</script>
<script setup lang="ts">
import { ref } from 'vue';
const props = defineProps<{ title: string }>();
const count = ref(0);
function increment() { count.value++; }
</script>
<template>
  <button v-for="item in [1, 2]" :key="item" @click="increment">
    {{ props.title }}😀{{ count }}
    <slot :value="item" />
  </button>
</template>
<style scoped>.button { color: red; }</style>
