<script lang="ts">
  import { toast } from '$lib/stores/toast.svelte';
</script>

<div id="toast" class="toast {toast.type}" class:show={toast.visible}>
  {toast.message}
</div>
