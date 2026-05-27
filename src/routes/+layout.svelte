<script lang="ts">
  import '../app.css';
  import Toast from '$lib/components/Toast.svelte';
  import { authState } from '$lib/stores/auth.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    authState.init();
  });
</script>

<Toast />

{@render children()}
