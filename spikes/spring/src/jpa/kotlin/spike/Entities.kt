package spike
import jakarta.persistence.*
import org.springframework.data.repository.CrudRepository

@Entity @Table(name = "rooms")
class Room(@Id @GeneratedValue(strategy=GenerationType.IDENTITY) var id: Long? = null, var title: String = "")
@Entity @Table(name = "anonymous_users")
class AnonymousUser(@Id @GeneratedValue(strategy=GenerationType.IDENTITY) var id: Long? = null, var alias: String = "")
@Entity @Table(name = "participants")
class Participant(
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) var id: Long? = null,
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="room_id", nullable=false) var room: Room? = null,
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="anonymous_user_id", nullable=false) var user: AnonymousUser? = null
)
interface RoomRepository : CrudRepository<Room, Long>
interface ParticipantRepository : CrudRepository<Participant, Long>
interface AnonymousUserRepository : CrudRepository<AnonymousUser, Long>
