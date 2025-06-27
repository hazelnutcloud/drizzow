## Checkpoint Specifications

The UnitOfWork class must be able to create logical checkpoints at arbitrary points in time. These checkpoints work to keep track of the state and the changes to entities tracked by the UoW instance at these arbitrary points of time.

Any changes to entities tracked by the UoW instance AFTER the creation of a checkpoint must be able to revert to its state at the time of the creation of that checkpoint.

Likewise, any changes to entities tracked by the UoW instance BEFORE the creation of a checkpoint must be able to be persisted to the underlying data store up to its state at the time of creation of the checkpoint.

Once persisted at a certain checkpoint, the user shall not be able to revert to a checkpoint from a point in time BEFORE the checkpoint where the persist action was made.

Likewise, once reverted to a certain checkpoint, the user shall not be able to persist to a checkpoint from a point in time AFTER the checkpoint where the revert action was made.

Reversion and persistence CAN be made at the exact same checkpoint.