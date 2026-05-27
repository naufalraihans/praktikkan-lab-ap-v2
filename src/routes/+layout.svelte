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

<div id="app-container">
  <div class="home-decor">
    <div class="laser-line laser-1"></div>
    <div class="laser-line laser-2"></div>
    <div class="laser-line laser-3"></div>
  </div>

  {@render children()}
</div>
